var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, 'name', { value, configurable: true });

// src/worker.js
function getHoursBetween(date1, date2) {
	if (!date1 || !date2) return 0;
	let diffInMs = new Date(date2) - new Date(date1);
	return Math.round((diffInMs / (1e3 * 60 * 60)) * 100) / 100;
}
__name(getHoursBetween, 'getHoursBetween');
var worker_default = {
	async fetch(request, env, ctx) {
		const { id: versionId, tag: versionTag, timestamp: versionTimestamp } = env.CF_VERSION_METADATA;
		const REVISION = '1.0.1';
		console.log(`******`);
		const ShortId = versionId.split('-')[0];
		console.log(`[versionId ${ShortId}] [versionTag ${versionTag}] [versionTimestamp ${versionTimestamp}]`);
		console.log(`******`);
		console.log(`[REVISION ${REVISION}] Request received`);
		console.log(`[REVISION ${REVISION}] Request received`);
		const TEAM_NAME = '13cafbf7-cb1e-4c12-a387-04b9374c14dd';
		const SCHEDULE_ID = env.OPSGENIE_SCHEDULE_ID;
		const OPSGENIE_API_KEY = env.OPSGENIE_TEAM_API_KEY;
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
			const processedData = {
				current: null,
				next: null,
			};
			const onCallUsers = data.data?.onCallParticipants;
			if (onCallUsers && onCallUsers.length > 0) {
				const currentUser = onCallUsers[0];
				console.log(`[REVISION ${REVISION}]`, JSON.stringify(currentUser, null, 2));
				console.log(`[REVISION ${REVISION}] ****** currentUser.name > ${currentUser.name}`);
				console.log(`[REVISION ${REVISION}] ****** currentUser.endDate > ${currentUser.endDate}`);
				const nextOnCall = nextOnCallsData.data?.onCallRecipients?.[0];
				const hoursLeft = nextOnCall?.onCallParticipants?.[0]?.endDate
					? getHoursBetween(/* @__PURE__ */ new Date(), nextOnCall.onCallParticipants[0].endDate)
					: getHoursBetween(/* @__PURE__ */ new Date(), currentUser.endDate);
				console.log(`[REVISION ${REVISION}]`, JSON.stringify(nextOnCallsData, null, 2));
				console.log(`[REVISION ${REVISION}] ****** nextOnCall > ${nextOnCall}`);
				console.log(`[REVISION ${REVISION}] ****** hoursLeft > ${hoursLeft}`);
				processedData.current = {
					name: currentUser.name,
					shiftEnds: currentUser.endDate,
					hoursLeft,
				};
			}
			const nextOnCallRecipients = nextOnCallsData.data?.onCallRecipients;
			console.log(`[REVISION ${REVISION}] ****** nextOnCallRecipients length:`, nextOnCallRecipients?.length);
			console.log(`[REVISION ${REVISION}] ****** Full nextOnCallsData:`, JSON.stringify(nextOnCallsData, null, 2));
			if (nextOnCallRecipients && nextOnCallRecipients.length > 1) {
				const nextUser = nextOnCallRecipients[1]?.onCallParticipants?.[0];
				console.log(`[REVISION ${REVISION}] ****** nextUser from index 1:`, JSON.stringify(nextUser, null, 2));
				if (nextUser) {
					processedData.next = {
						name: nextUser.name,
						shiftStarts: nextUser.startDate,
						shiftDurationHours: getHoursBetween(nextUser.startDate, nextUser.endDate),
					};
				}
			} else if (nextOnCallRecipients && nextOnCallRecipients.length === 1) {
				const potentialNextUser = nextOnCallRecipients[0]?.onCallParticipants?.[0];
				console.log(`[REVISION ${REVISION}] ****** potentialNextUser from index 0:`, JSON.stringify(potentialNextUser, null, 2));
				if (potentialNextUser && new Date(potentialNextUser.startDate) > /* @__PURE__ */ new Date()) {
					processedData.next = {
						name: potentialNextUser.name,
						shiftStarts: potentialNextUser.startDate,
						shiftDurationHours: getHoursBetween(potentialNextUser.startDate, potentialNextUser.endDate),
					};
				}
			}
			if (!processedData.next) {
				console.log(`[REVISION ${REVISION}] ****** Falling back to original metadata`);
				const nextOnCallUsers = data._meta?.nextOnCallRecipients;
				console.log(`[REVISION ${REVISION}] ****** nextOnCallUsers from metadata:`, JSON.stringify(nextOnCallUsers, null, 2));
				if (nextOnCallUsers && nextOnCallUsers.length > 0) {
					const nextUser = nextOnCallUsers[0];
					processedData.next = {
						name: nextUser.name,
						shiftStarts: nextUser.startDate,
						shiftDurationHours: getHoursBetween(nextUser.startDate, nextUser.endDate),
					};
				}
			}
			console.log(`[REVISION ${REVISION}] ****** Final processedData:`, JSON.stringify(processedData, null, 2));
			return new Response(JSON.stringify(processedData), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					// Or your specific domain
				},
			});
		} catch (error) {
			console.log(`[REVISION ${REVISION}] ERROR: Failed to fetch from Opsgenie API:`, error);
			return new Response(JSON.stringify({ error: 'Failed to fetch from Opsgenie API.' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}
	},
};
export { worker_default as default };
//# sourceMappingURL=worker.js.map
