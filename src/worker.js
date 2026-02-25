// This is the code for your Cloudflare Worker
// This is the updated code for your Cloudflare Worker

// A helper function to calculate the difference between two dates in hours
function getHoursBetween(date1, date2) {
	if (!date1 || !date2) return 0;
	// @ts-ignore
	let diffInMs = new Date(date2) - new Date(date1);
	// Round to two decimal places
	return Math.round((diffInMs / (1000 * 60 * 60)) * 100) / 100;
}

export default {
	async fetch(request, env, ctx) {
		// --- Configuration ---
		const REVISION = '1.0.1'; // Update this with each deployment
		console.log(`[REVISION ${REVISION}] Request received`);
		
		// Replace these with your actual team and schedule names
		const TEAM_NAME = '13cafbf7-cb1e-4c12-a387-04b9374c14dd';
		const SCHEDULE_ID = env.OPSGENIE_SCHEDULE_ID;
		// IMPORTANT: The API Key is a secret, handled in the Cloudflare dashboard, not in the code.
		// We access it via the `env` object.
		const OPSGENIE_API_KEY = env.OPSGENIE_TEAM_API_KEY;

		// --- End Configuration ---
		if (!OPSGENIE_API_KEY) {
			console.log(`[REVISION ${REVISION}] ERROR: API key not configured`);
			return new Response(JSON.stringify({ error: 'API key is not configured in Worker secrets.' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}

		const opsgenieUrl = `https://api.opsgenie.com/v2/schedules/${encodeURIComponent(SCHEDULE_ID)}/on-calls?teamIdentifierType=name&teamIdentifier=${encodeURIComponent(TEAM_NAME)}`;
		const nextOnCallsUrl = `https://api.opsgenie.com/v2/schedules/${encodeURIComponent(SCHEDULE_ID)}/next-on-calls?flat=true`;

		try {
			// Make both API calls in parallel
			const [opsgenieResponse, nextOnCallsResponse] = await Promise.all([
				fetch(opsgenieUrl, {
					headers: { Authorization: `GenieKey ${OPSGENIE_API_KEY}` },
				}),
				fetch(nextOnCallsUrl, {
					headers: { Authorization: `GenieKey ${OPSGENIE_API_KEY}` },
				}),
			]);

			const data = await opsgenieResponse.json();
			const nextOnCallsData = await nextOnCallsResponse.json();

			if (!opsgenieResponse.ok) {
				return new Response(JSON.stringify(data), {
					status: opsgenieResponse.status,
					headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
				});
			}

			if (!nextOnCallsResponse.ok) {
				return new Response(JSON.stringify(nextOnCallsData), {
					status: nextOnCallsResponse.status,
					headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
				});
			}

			// --- Process the data before sending to the front-end ---
			const processedData = {
				current: null,
				next: null,
			};

			// Process current on-call user
			const onCallUsers = data.data?.onCallParticipants;
			if (onCallUsers && onCallUsers.length > 0) {
				const currentUser = onCallUsers[0];

				console.log(`[REVISION ${REVISION}]`, JSON.stringify(currentUser, null, 2));
				console.log(`[REVISION ${REVISION}] ****** currentUser.name > ${currentUser.name}`);
				console.log(`[REVISION ${REVISION}] ****** currentUser.endDate > ${currentUser.endDate}`);

				// Get the hours left from the next-on-calls endpoint
				const nextOnCall = nextOnCallsData.data?.onCallRecipients?.[0];
				const hoursLeft = nextOnCall?.onCallParticipants?.[0]?.endDate
					? getHoursBetween(new Date(), nextOnCall.onCallParticipants[0].endDate)
					: getHoursBetween(new Date(), currentUser.endDate);

				console.log(`[REVISION ${REVISION}]`, JSON.stringify(nextOnCallsData, null, 2));
				console.log(`[REVISION ${REVISION}] ****** nextOnCall > ${nextOnCall}`);
				console.log(`[REVISION ${REVISION}] ****** hoursLeft > ${hoursLeft}`);

				processedData.current = {
					name: currentUser.name,
					shiftEnds: currentUser.endDate,
					hoursLeft: hoursLeft,
				};
			}

			// Process next on-call user
			// The next-on-calls endpoint returns future on-call rotations
			// The first recipient is the current on-call, the second is the next
			const nextOnCallRecipients = nextOnCallsData.data?.onCallRecipients;
			
			console.log('****** nextOnCallRecipients length:', nextOnCallRecipients?.length);
			console.log('****** Full nextOnCallsData:', JSON.stringify(nextOnCallsData, null, 2));
			
			if (nextOnCallRecipients && nextOnCallRecipients.length > 1) {
				// The second recipient is the next on-call
				const nextUser = nextOnCallRecipients[1]?.onCallParticipants?.[0];
				console.log('****** nextUser from index 1:', JSON.stringify(nextUser, null, 2));
				if (nextUser) {
					processedData.next = {
						name: nextUser.name,
						shiftStarts: nextUser.startDate,
						shiftDurationHours: getHoursBetween(nextUser.startDate, nextUser.endDate),
					};
				}
			} else if (nextOnCallRecipients && nextOnCallRecipients.length === 1) {
				// If there's only one recipient, check if it's different from current
				const potentialNextUser = nextOnCallRecipients[0]?.onCallParticipants?.[0];
				console.log('****** potentialNextUser from index 0:', JSON.stringify(potentialNextUser, null, 2));
				
				// Check if this user's shift starts after now (meaning they're next, not current)
				if (potentialNextUser && new Date(potentialNextUser.startDate) > new Date()) {
					processedData.next = {
						name: potentialNextUser.name,
						shiftStarts: potentialNextUser.startDate,
						shiftDurationHours: getHoursBetween(potentialNextUser.startDate, potentialNextUser.endDate),
					};
				}
			}
			
			// If we still don't have next user, fall back to the original metadata
			if (!processedData.next) {
				console.log('****** Falling back to original metadata');
				const nextOnCallUsers = data._meta?.nextOnCallRecipients;
				console.log('****** nextOnCallUsers from metadata:', JSON.stringify(nextOnCallUsers, null, 2));
				if (nextOnCallUsers && nextOnCallUsers.length > 0) {
					const nextUser = nextOnCallUsers[0];
					processedData.next = {
						name: nextUser.name,
						shiftStarts: nextUser.startDate,
						shiftDurationHours: getHoursBetween(nextUser.startDate, nextUser.endDate),
					};
				}
			}
			// --- End Processing ---

			// Return the new, cleaner data object
			return new Response(JSON.stringify(processedData), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*', // Or your specific domain
				},
			});
		} catch (error) {
			return new Response(JSON.stringify({ error: 'Failed to fetch from Opsgenie API.' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}
	},
};
