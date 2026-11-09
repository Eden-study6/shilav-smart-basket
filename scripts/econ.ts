import { detectAllCampaigns, UNIT_ECONOMICS } from '../lib/campaignEngine';
const NOW = new Date('2026-09-08T09:00:00+03:00');
const all = detectAllCampaigns({ now: NOW });

const inBand = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? 'OK ' : '<< ');

console.log('stream    type              sample  reach  conv    AOV     projected     bands');
console.log('-'.repeat(96));
for (const c of all) {
  const a = c.audience;
  const isLife = c.stream === 'lifecycle';
  const m = isLife ? UNIT_ECONOMICS.lifecycle : UNIT_ECONOMICS.anomaly;
  const revBand: [number, number] = isLife ? [60000, 120000] : [1500, 3500];
  console.log(
    `${c.stream.padEnd(10)}${c.type.padEnd(18)}${String(a.matchedInSample).padStart(4)}  ` +
    `${String(a.estimatedReach).padStart(6)} ${String(Math.round(a.assumedConversionRate*100)+'%').padStart(5)} ` +
    `${String(a.averageBasketValue).padStart(7)} ₪${String(a.projectedRevenue).padStart(8)}  ` +
    `size:${inBand(a.estimatedReach, m.segmentSize.min, m.segmentSize.max)}` +
    `aov:${inBand(a.averageBasketValue, m.averageOrderValue.min, m.averageOrderValue.max)}` +
    `rev:${inBand(a.projectedRevenue, revBand[0], revBand[1])}`
  );
}
const life = all.filter(c=>c.stream==='lifecycle').reduce((s,c)=>s+c.audience.projectedRevenue,0);
const anom = all.filter(c=>c.stream==='anomaly').reduce((s,c)=>s+c.audience.projectedRevenue,0);
console.log(`\ntotals: lifecycle ₪${life.toLocaleString('en-US')} | anomaly ₪${anom.toLocaleString('en-US')} | ratio ${(life/anom).toFixed(1)}x`);
