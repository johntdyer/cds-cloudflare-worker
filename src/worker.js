var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, 'name', { value, configurable: true });

function getHoursBetween(date1, date2) {
	if (!date1 || !date2) return 0;
	let diffInMs = new Date(date2) - new Date(date1);
	return Math.round((diffInMs / (1e3 * 60 * 60)) * 100) / 100;
}
__name(getHoursBetween, 'getHoursBetween');

function humanize(str) {
	if (!str) return 'Unknown';
	return str
		.split('@')[0]
		.replace(/^[\s_]+|[\s_]+$/g, '')
		.replace(/[\_\s]+/g, ' ')
		.replace(/\./g, ' ')
		.replace(/\b[a-z]/g, (x) => x.toUpperCase());
}
__name(humanize, 'humanize');

async function fetchScheduleInfo(scheduleId, scheduleName, env, logger) {
	const OPSGENIE_API_KEY = env.OPSGENIE_TEAM_API_KEY;
	const opsgenieUrl = `https://api.opsgenie.com/v2/schedules/${encodeURIComponent(scheduleId)}/on-calls`;
	const timelineUrl = `https://api.opsgenie.com/v2/schedules/${encodeURIComponent(scheduleId)}/timeline?interval=1&intervalUnit=months`;

	try {
		const [opsgenieResponse, timelineResponse] = await Promise.all([
			fetch(opsgenieUrl, { headers: { Authorization: `GenieKey ${OPSGENIE_API_KEY}` } }),
			fetch(timelineUrl, { headers: { Authorization: `GenieKey ${OPSGENIE_API_KEY}` } }),
		]);

		if (!opsgenieResponse.ok || !timelineResponse.ok) {
			logger.warn(
				`Failed to fetch from Opsgenie for schedule ${scheduleName} (Status: ${opsgenieResponse.status} / ${timelineResponse.status})`,
			);
			return { scheduleName, error: 'Failed to fetch from Opsgenie' };
		}

		const data = await opsgenieResponse.json();
		const timelineData = await timelineResponse.json();

		const processedData = {
			scheduleName,
			current: null,
			next: null,
		};

		let allPeriods = [];
		if (timelineData.data?.finalTimeline?.rotations) {
			for (const rotation of timelineData.data.finalTimeline.rotations) {
				if (rotation.periods) {
					allPeriods.push(...rotation.periods);
				}
			}
		}

		allPeriods.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
		const now = new Date();
		const currentPeriod = allPeriods.find((p) => new Date(p.startDate) <= now && new Date(p.endDate) > now);
		const nextPeriodThreshold = currentPeriod ? new Date(currentPeriod.endDate) : now;
		const nextPeriod = allPeriods.find((p) => new Date(p.startDate) >= nextPeriodThreshold);

		const onCallUsers = data.data?.onCallParticipants;
		if (onCallUsers && onCallUsers.length > 0) {
			const currentUser = onCallUsers[0];
			const shiftEnds = currentPeriod ? currentPeriod.endDate : null;
			processedData.current = {
				name: humanize(currentUser.name),
				shiftEnds: shiftEnds,
				hoursLeft: shiftEnds ? getHoursBetween(now, shiftEnds) : 0,
			};
		} else if (currentPeriod) {
			const shiftEnds = currentPeriod.endDate;
			processedData.current = {
				name: humanize(currentPeriod.recipient?.name),
				shiftEnds: shiftEnds,
				hoursLeft: getHoursBetween(now, shiftEnds),
			};
		}

		if (nextPeriod) {
			processedData.next = {
				name: humanize(nextPeriod.recipient?.name),
				shiftStarts: nextPeriod.startDate,
				shiftDurationHours: getHoursBetween(nextPeriod.startDate, nextPeriod.endDate),
			};
		}

		logger.debug(`Successfully processed schedule: ${scheduleName}`);
		return processedData;
	} catch (error) {
		logger.error(`ERROR fetching schedule ${scheduleName}:`, error);
		return { scheduleName, error: 'Error fetching data' };
	}
}
__name(fetchScheduleInfo, 'fetchScheduleInfo');

var worker_default = {
	async fetch(request, env, ctx) {
		// Set up context and logging
		const {
			id: versionId,
			tag: versionTag,
			timestamp: versionTimestamp,
		} = env.CF_VERSION_METADATA || { id: 'dev-0', tag: 'dev', timestamp: Date.now() };
		const ShortId = versionId.split('-')[0];
		const prefix = `[RevId: ${ShortId}]`;

		const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
		const configuredLevel = LOG_LEVELS[(env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LOG_LEVELS.INFO;

		const logger = {
			debug: (...args) => configuredLevel <= LOG_LEVELS.DEBUG && console.debug('[DEBUG]', prefix, ...args),
			info: (...args) => configuredLevel <= LOG_LEVELS.INFO && console.info('[INFO]', prefix, ...args),
			warn: (...args) => configuredLevel <= LOG_LEVELS.WARN && console.warn('[WARN]', prefix, ...args),
			error: (...args) => configuredLevel <= LOG_LEVELS.ERROR && console.error('[ERROR]', prefix, ...args),
		};

		const OPSGENIE_API_KEY = env.OPSGENIE_TEAM_API_KEY;

		if (!OPSGENIE_API_KEY) {
			logger.error('API key not configured');
			return new Response(JSON.stringify({ error: 'API key is not configured in Worker secrets.' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}

		logger.debug(`[versionTag ${versionTag}] [versionTimestamp ${versionTimestamp}]`);
		logger.info('Request received');

		try {
			// Get all schedules for the team
			const schedulesUrl = `https://api.opsgenie.com/v2/schedules`;
			const schedulesResponse = await fetch(schedulesUrl, {
				headers: { Authorization: `GenieKey ${OPSGENIE_API_KEY}` },
			});

			if (!schedulesResponse.ok) {
				const errData = await schedulesResponse.json().catch(() => ({}));
				logger.error('Failed to fetch schedules list', errData);
				return new Response(JSON.stringify({ error: 'Failed to fetch schedules list', details: errData }), {
					status: schedulesResponse.status,
					headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
				});
			}

			const schedulesData = await schedulesResponse.json();
			const schedules = schedulesData.data || [];

			var foundSchedules = [];

			schedules.forEach((s) => {
				foundSchedules.push(`- Schedule ID: ${s.id}, Name: "${s.name}", Description: "${s.description || 'none'}"`);
			});
			logger.info(`Found ${schedules.length} schedules visible to token: [ ${foundSchedules} ]`);

			// Fetch details for ALL schedules concurrently
			const schedulePromises = schedules.map((schedule) => fetchScheduleInfo(schedule.id, schedule.name, env, logger));

			const resultsArray = await Promise.all(schedulePromises);

			// Convert array to an object keyed by scheduleName
			const resultsObject = {};
			for (const res of resultsArray) {
				resultsObject[res.scheduleName] = {
					current: res.current,
					next: res.next,
				};
				if (res.error) {
					resultsObject[res.scheduleName].error = res.error;
				}
			}

			logger.info(`Final Processed Data for ${schedules.length} schedules`);
			logger.debug('Payload:', JSON.stringify(resultsObject));

			return new Response(JSON.stringify(resultsObject), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				},
			});
		} catch (error) {
			logger.error('Failed to process Opsgenie API requests:', error);
			return new Response(JSON.stringify({ error: 'Failed to process Opsgenie API requests.' }), {
				status: 502,
				headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
			});
		}
	},
};

export { worker_default as default };
