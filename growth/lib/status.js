import { STATUSES, countsByStatus, countsByChannel, sentTodayCount } from './store.js';
import { CHANNELS, DAILY_CAPS, GOAL } from '../config.js';

export async function getStatusSnapshot() {
  const byStatus = await countsByStatus();
  const byChannel = await countsByChannel(CHANNELS);
  const sentToday = {};
  for (const c of CHANNELS) sentToday[c] = await sentTodayCount(c);

  const won = byStatus.won || 0;
  const mrr = won * GOAL.pricePerCustomer;
  const daysLeft = Math.ceil((new Date(GOAL.deadline) - Date.now()) / 86400000);

  return {
    statuses: STATUSES,
    byStatus,
    channels: CHANNELS,
    byChannel,
    dailyCaps: DAILY_CAPS,
    sentToday,
    goal: { ...GOAL, customersNeeded: GOAL.customersNeeded },
    won,
    mrr,
    customersRemaining: Math.max(0, GOAL.customersNeeded - won),
    daysLeft,
  };
}
