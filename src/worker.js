var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, 'name', { value, configurable: true });

// src/worker.js
function getHoursBetween(date1, date2) {
	if (!date1 || !date2) return 0;
	let diffInMs = new Date(date2) - new Date(date1);
	return Math.round((diffInMs / (1e3 * 60 * 60)) * 100) / 100;
}

function humanize(str) {
	return str
		.split('@')[0]
		.replace(/^[\s_]+|[\s_]+$/g, '')
		.replace(/[_\s]+/g, ' ')
		.replace(/\./g, ' ')
		.replace(/\b[a-z]/g, (x) => x.toUpperCase());
}

__name(getHoursBetween, 'getHoursBetween');

var worker_default = {
	async fetch(request, env, ctx) {
		const { id: versionId, tag: versionTag, timestamp: versionTimestamp } = env.CF_VERSION_METADATA;
		const ShortId = versionId.split('-')[0];
		const TEAM_NAME = '13cafbf7-cb1e-4c12-a387-04b9374c14dd';
		const SCHEDULE_ID = env.OPSGENIE_SCHEDULE_ID;
		const OPSGENIE_API_KEY = env.OPSGENIE_TEAM_API_KEY;
		if (!OPSGENIE_API_KEY) {
			console.log(`[REVISION ${ShortId}] ERROR: API key not configured`);
			return new Response(JSON.stringify({ error: 'API key is not configured in Worker secrets.' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}
		const opsgenieUrl = `https://api.opsgenie.com/v2/schedules/${encodeURIComponent(SCHEDULE_ID)}/on-calls?teamIdentifierType=name&teamIdentifier=${encodeURIComponent(TEAM_NAME)}`;
		const timelineUrl = `https://api.opsgenie.com/v2/schedules/${encodeURIComponent(SCHEDULE_ID)}/timeline?interval=1&intervalUnit=months`;

		console.log(`[versionId ${ShortId}] [versionTag ${versionTag}] [versionTimestamp ${versionTimestamp}]`);
		console.log(`[REVISION ${ShortId}] Request received`);

		try {
			// Fetch both on-calls (to get exact current user info) and timeline (to get shift start/end dates)
			const [opsgenieResponse, timelineResponse] = await Promise.all([
				fetch(opsgenieUrl, {
					headers: { Authorization: `GenieKey ${OPSGENIE_API_KEY}` },
				}),
				fetch(timelineUrl, {
					headers: { Authorization: `GenieKey ${OPSGENIE_API_KEY}` },
				}),
			]);

			const data = await opsgenieResponse.json();
			const timelineData = await timelineResponse.json();

			if (!opsgenieResponse.ok) {
				return new Response(JSON.stringify(data), {
					status: opsgenieResponse.status,
					headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
				});
			}
			if (!timelineResponse.ok) {
				return new Response(JSON.stringify(timelineData), {
					status: timelineResponse.status,
					headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
				});
			}

			const processedData = {
				current: null,
				next: null,
			};

			// Extract all shift periods from the timeline
			let allPeriods = [];
			if (timelineData.data?.finalTimeline?.rotations) {
				for (const rotation of timelineData.data.finalTimeline.rotations) {
					if (rotation.periods) {
						allPeriods.push(...rotation.periods);
					}
				}
			}

			// Sort periods chronologically
			allPeriods.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

			const now = new Date();

			// Find current shift period
			const currentPeriod = allPeriods.find((p) => new Date(p.startDate) <= now && new Date(p.endDate) > now);

			// Find next shift period
			const nextPeriodThreshold = currentPeriod ? new Date(currentPeriod.endDate) : now;
			const nextPeriod = allPeriods.find((p) => new Date(p.startDate) >= nextPeriodThreshold);

			const onCallUsers = data.data?.onCallParticipants;
			if (onCallUsers && onCallUsers.length > 0) {
				const currentUser = onCallUsers[0];

				// We use the timeline's currentPeriod to get the exact endDate
				const shiftEnds = currentPeriod ? currentPeriod.endDate : null;
				const hoursLeft = shiftEnds ? getHoursBetween(now, shiftEnds) : 0;

				processedData.current = {
					name: humanize(currentUser.name),
					shiftEnds: shiftEnds,
					hoursLeft: hoursLeft,
				};

				console.log(`[REVISION ${ShortId}] ****** currentUser.name > ${humanize(currentUser.name)}`);
				console.log(`[REVISION ${ShortId}] ****** shiftEnds > ${shiftEnds}`);
				console.log(`[REVISION ${ShortId}] ****** hoursLeft > ${hoursLeft}`);
			} else if (currentPeriod) {
				// Fallback if on-call endpoint didn't have participants but timeline does
				const shiftEnds = currentPeriod.endDate;
				processedData.current = {
					name: humanize(currentPeriod.recipient?.name) || 'Unknown',
					shiftEnds: shiftEnds,
					hoursLeft: getHoursBetween(now, shiftEnds),
				};
			}

			if (nextPeriod) {
				processedData.next = {
					name: humanize(nextPeriod.recipient?.name || 'Unknown'),
					shiftStarts: nextPeriod.startDate,
					shiftDurationHours: getHoursBetween(nextPeriod.startDate, nextPeriod.endDate),
				};
				console.log(`[REVISION ${ShortId}] ****** nextUser.name > ${humanize(processedData.next.name)}`);
				console.log(`[REVISION ${ShortId}] ****** nextUser shiftStarts > ${processedData.next.shiftStarts}`);
			}
			console.log(`[REVISION ${ShortId}] ****** Final processedData:`, JSON.stringify(processedData, null, 2));
			return new Response(JSON.stringify(processedData), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					// Or your specific domain
				},
			});
		} catch (error) {
			console.log(`[REVISION ${ShortId}] ERROR: Failed to fetch from Opsgenie API:`, error);
			return new Response(JSON.stringify({ error: 'Failed to fetch from Opsgenie API.' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}
	},
};
export { worker_default as default };
//# sourceMappingURL=worker.js.map
