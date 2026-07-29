/**
 * Implied volatility: inverting the pricer, and knowing when the answer means anything.
 *
 * Run with: pnpm examples
 */

import {
  bsCall,
  ConvergenceError,
  impliedVolatility,
  InvalidInputError,
  vega,
} from '../src/index.js';

const contract = {
  spot: 42,
  strike: 40,
  timeToExpiry: 0.5,
  riskFreeRate: 0.1,
};

// Price with a known volatility, then recover it.
const known = 0.2;
const price = bsCall({ ...contract, volatility: known });
const recovered = impliedVolatility({ ...contract, optionPrice: price, optionType: 'call' });

console.log('Round trip');
console.log('  volatility in   ', known);
console.log('  price           ', price);
console.log('  volatility out  ', recovered);
console.log('  error           ', Math.abs(recovered - known));

// A volatility smile: the same underlying quoted at different strikes implies different
// volatilities. That is the market disagreeing with Black-Scholes, not an error.
//
// The quotes below are generated from a skew and then rounded to a cent, the way a screen would
// show them. Inverting the rounded price recovers the skew, with the rounding visible in the
// last digits — which is what a real quote does too.
console.log('\nImplied volatility by strike, from a skew rounded to the cent');
const skew = [
  { strike: 35, volatility: 0.26 },
  { strike: 40, volatility: 0.22 },
  { strike: 45, volatility: 0.2 },
  { strike: 50, volatility: 0.21 },
];
for (const point of skew) {
  const quoted = Math.round(bsCall({ ...contract, ...point }) * 100) / 100;
  const implied = impliedVolatility({
    ...contract,
    strike: point.strike,
    optionPrice: quoted,
    optionType: 'call',
  });
  console.log(
    `  strike ${point.strike}   quoted ${quoted.toFixed(2).padStart(5)}   ` +
      `true ${(point.volatility * 100).toFixed(2)}%   implied ${(implied * 100).toFixed(2)}%`,
  );
}

// How precisely volatility can be recovered is set by vega, not by the solver.
console.log('\nWhat vega does to the precision available');
for (const strike of [40, 70, 120]) {
  const inputs = { ...contract, strike, volatility: 0.2 };
  const slope = vega(inputs);
  console.log(
    `  strike ${String(strike).padStart(3)}   vega ${slope.toExponential(3)}   ` +
      `sigma resolvable to about ${(1e-10 / slope).toExponential(2)}`,
  );
}

// Failure is always an exception carrying a reason. Nothing here ever returns NaN.
console.log('\nFailure modes');
for (const attempt of [
  { label: 'price below intrinsic', optionPrice: 1 },
  { label: 'price above the spot', optionPrice: 60 },
]) {
  try {
    impliedVolatility({ ...contract, optionPrice: attempt.optionPrice, optionType: 'call' });
    console.log(`  ${attempt.label}: no error`);
  } catch (error) {
    const kind =
      error instanceof InvalidInputError
        ? 'InvalidInputError'
        : error instanceof ConvergenceError
          ? 'ConvergenceError'
          : 'Error';
    console.log(`  ${attempt.label}: ${kind} — ${(error as Error).message.slice(0, 72)}...`);
  }
}
