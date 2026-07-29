/**
 * Smoke test against the BUILT package, not the source.
 *
 * The other examples import from `../src`, which proves the code works. This one imports from
 * `../dist`, which proves the thing that actually gets published works — that the entry points
 * resolve, that the exports map is right, and that tree-shaking has not dropped anything.
 *
 * Run with: pnpm examples:smoke   (builds first)
 */

import {
  bsCall,
  bsPut,
  callGreeks,
  crrPrice,
  historicalVar,
  impliedVolatility,
  kellyFraction,
  normalCdf,
  probabilityItmUnderQ,
  thetaPerCalendarDay,
  vegaPerPercentagePoint,
} from '../dist/index.js';

const contract = {
  spot: 42,
  strike: 40,
  timeToExpiry: 0.5,
  riskFreeRate: 0.1,
  volatility: 0.2,
};

const checks = [
  ['bsCall', bsCall(contract), 4.7594],
  ['bsPut', bsPut(contract), 0.8086],
  // The American put carries an early-exercise premium of about 0.10 over the European 0.8086.
  [
    'crrPrice american put',
    crrPrice({ ...contract, optionType: 'put', exerciseStyle: 'american', steps: 500 }),
    0.9103,
  ],
  ['callGreeks.delta', callGreeks(contract).delta, 0.779],
  [
    'impliedVolatility',
    impliedVolatility({ ...contract, optionPrice: bsCall(contract), optionType: 'call' }),
    0.2,
  ],
  ['normalCdf(1.96)', normalCdf(1.96), 0.975],
  ['probabilityItmUnderQ', probabilityItmUnderQ({ ...contract, optionType: 'call' }), 0.73],
  [
    'historicalVar',
    historicalVar({ returns: [-0.05, 0.01, -0.02, 0.03, -0.01], confidenceLevel: 0.95 }),
    0.044,
  ],
  ['kellyFraction', kellyFraction({ winProbability: 0.6, winPayoff: 1 }), 0.2],
];

let failures = 0;

console.log('Smoke test against dist/\n');
for (const [name, actual, expected] of checks) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) < 0.01;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(24)} ${actual}`);
}

// The scaling helpers must survive the build too.
console.log('');
console.log('  vega per point   ', vegaPerPercentagePoint(callGreeks(contract).vega));
console.log('  theta per day    ', thetaPerCalendarDay(callGreeks(contract).theta));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed against the built package`);
  process.exit(1);
}
console.log('\nAll checks passed against the built package.');
