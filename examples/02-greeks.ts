/**
 * Greeks, and the unit conventions that go with them.
 *
 * Run with: pnpm examples
 */

import {
  callGreeks,
  putGreeks,
  rhoPerPercentagePoint,
  thetaPerCalendarDay,
  thetaPerTradingDay,
  vegaPerPercentagePoint,
} from '../src/index.js';

// Hull, Options, Futures and Other Derivatives, chapter 17.
const contract = {
  spot: 49,
  strike: 50,
  timeToExpiry: 0.3846,
  riskFreeRate: 0.05,
  volatility: 0.2,
};

const greeks = callGreeks(contract);

console.log('Raw units — what the core always returns');
console.log('  delta   ', greeks.delta, '  per 1.0 of spot');
console.log('  gamma   ', greeks.gamma, '  per 1.0 of spot squared');
console.log('  vega    ', greeks.vega, '  per 1.00 of volatility');
console.log('  theta   ', greeks.theta, '  per year');
console.log('  rho     ', greeks.rho, '  per 1.00 of rate');

console.log('\nScaled — only ever through a function that names the unit');
console.log('  vega per volatility point ', vegaPerPercentagePoint(greeks.vega));
console.log('  theta per calendar day    ', thetaPerCalendarDay(greeks.theta));
console.log('  theta per trading day     ', thetaPerTradingDay(greeks.theta), '(252 days)');
console.log('  theta per trading day     ', thetaPerTradingDay(greeks.theta, 250), '(250 days)');
console.log('  rho per rate point        ', rhoPerPercentagePoint(greeks.rho));

// Call and put delta differ by exactly the dividend discount factor; gamma and vega are shared.
const put = putGreeks(contract);
console.log('\nCall against put');
console.log('  call delta   ', greeks.delta);
console.log('  put delta    ', put.delta);
console.log('  difference   ', greeks.delta - put.delta, ' = e^(-qT) = 1 with no yield');
console.log('  gamma equal  ', greeks.gamma === put.gamma);
console.log('  vega equal   ', greeks.vega === put.vega);

// Gamma peaks near the money and decays either side of it.
console.log('\nGamma across moneyness');
for (const spot of [30, 40, 50, 60, 80]) {
  const at = callGreeks({ ...contract, spot });
  console.log(
    `  spot ${String(spot).padStart(3)}   delta ${at.delta.toFixed(6)}   gamma ${at.gamma.toFixed(6)}   vega ${at.vega.toFixed(6)}`,
  );
}
