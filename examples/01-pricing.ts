/**
 * Pricing European and American options.
 *
 * Run with: pnpm examples
 */

import { bsCall, bsPut, crrPrice } from '../src/index.js';

// Hull, Options, Futures and Other Derivatives, Example 13.6.
const contract = {
  spot: 42,
  strike: 40,
  timeToExpiry: 0.5, // years
  riskFreeRate: 0.1, // 10% — a decimal fraction, not 10
  volatility: 0.2, // 20% annualised
};

console.log('European, Black-Scholes');
console.log('  call            ', bsCall(contract));
console.log('  put             ', bsPut(contract));

// Put-call parity is an identity, not an approximation.
const parity = bsCall(contract) - bsPut(contract);
const forward = contract.spot - contract.strike * Math.exp(-0.1 * 0.5);
console.log('  C - P           ', parity);
console.log('  S - K e^(-rT)   ', forward);
console.log('  difference      ', Math.abs(parity - forward));

// A dividend yield lowers a call and raises a put.
const withYield = { ...contract, dividendYield: 0.04 };
console.log('\nWith a 4% dividend yield');
console.log('  call            ', bsCall(withYield));
console.log('  put             ', bsPut(withYield));

// American exercise needs a tree. Convergence is O(1/n) and oscillates, so use enough steps
// that the answer is stable rather than merely plausible.
console.log('\nAmerican put on a binomial tree');
for (const steps of [10, 100, 1000]) {
  const american = crrPrice({ ...contract, optionType: 'put', exerciseStyle: 'american', steps });
  const european = crrPrice({ ...contract, optionType: 'put', exerciseStyle: 'european', steps });
  console.log(
    `  ${String(steps).padStart(4)} steps    american ${american.toFixed(10)}   ` +
      `european ${european.toFixed(10)}   early-exercise premium ${(american - european).toFixed(10)}`,
  );
}

// At expiry there is nothing left but intrinsic value.
console.log('\nAt expiry');
console.log('  call            ', bsCall({ ...contract, timeToExpiry: 0 }));
console.log('  put             ', bsPut({ ...contract, timeToExpiry: 0 }));
