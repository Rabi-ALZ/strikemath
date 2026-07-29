/**
 * Risk measures: risk-neutral probabilities, VaR, CVaR and Kelly.
 *
 * Run with: pnpm examples
 */

import {
  bsCall,
  fractionalKelly,
  historicalCvar,
  historicalVar,
  kellyFraction,
  parametricCvar,
  parametricVar,
  probabilityItmUnderQ,
  probabilityOfProfitUnderQ,
} from '../src/index.js';

const contract = {
  spot: 100,
  strike: 110,
  timeToExpiry: 0.25,
  riskFreeRate: 0.05,
  volatility: 0.3,
};

// Every probability here is under the risk-neutral measure Q. It is a price expressed in
// probability units — what the market charges for a binary payoff — NOT a forecast.
const premium = bsCall(contract);
console.log('Risk-neutral probabilities (Q — not forecasts)');
console.log('  call premium            ', premium.toFixed(6));
console.log(
  '  P(finishes ITM)         ',
  probabilityItmUnderQ({ ...contract, optionType: 'call' }),
);
console.log(
  '  P(beyond break-even)    ',
  probabilityOfProfitUnderQ({ ...contract, optionType: 'call', premium }),
);
console.log('  break-even price        ', contract.strike + premium * Math.exp(0.05 * 0.25));

// Value at Risk and Conditional Value at Risk. Losses come out as positive numbers.
const returns = [
  -0.021, 0.014, -0.008, 0.032, -0.045, 0.007, -0.013, 0.019, -0.002, 0.011, -0.038, 0.024, -0.016,
  0.005, -0.029, 0.041, -0.006, 0.013, -0.052, 0.018,
];

console.log('\nValue at Risk from 20 daily returns (losses are positive)');
for (const confidenceLevel of [0.9, 0.95, 0.99]) {
  const var_ = historicalVar({ returns, confidenceLevel });
  const cvar = historicalCvar({ returns, confidenceLevel });
  console.log(
    `  ${(confidenceLevel * 100).toFixed(0)}%   VaR ${(var_ * 100).toFixed(3)}%   CVaR ${(cvar * 100).toFixed(3)}%`,
  );
}

// The parametric versions assume normality, which understates the tail — which is precisely
// where the number is being used.
const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
const variance =
  returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);
const standardDeviation = Math.sqrt(variance);

console.log('\nParametric, assuming normal returns');
console.log('  mean                    ', mean.toFixed(6));
console.log('  standard deviation      ', standardDeviation.toFixed(6));
for (const confidenceLevel of [0.95, 0.99]) {
  const inputs = { mean, standardDeviation, confidenceLevel };
  console.log(
    `  ${(confidenceLevel * 100).toFixed(0)}%   VaR ${(parametricVar(inputs) * 100).toFixed(3)}%   ` +
      `CVaR ${(parametricCvar(inputs) * 100).toFixed(3)}%`,
  );
}
console.log(
  '  historical 95% VaR      ',
  (historicalVar({ returns, confidenceLevel: 0.95 }) * 100).toFixed(3) + '%',
);
console.log('  ^ compare the two before trusting either');

// Kelly. Full Kelly assumes the edge is known exactly, which it never is.
console.log('\nKelly sizing on a 60/40 even-money edge');
const full = kellyFraction({ winProbability: 0.6, winPayoff: 1 });
console.log('  full Kelly              ', full);
console.log('  half Kelly              ', fractionalKelly(full, 0.5));
console.log('  quarter Kelly           ', fractionalKelly(full, 0.25));

console.log('\nWhat overestimating the edge does');
for (const belief of [0.6, 0.55, 0.5, 0.45]) {
  const sized = kellyFraction({ winProbability: belief, winPayoff: 1 });
  console.log(
    `  you believe p = ${belief.toFixed(2)}   Kelly says ${(sized * 100).toFixed(1)}%` +
      (sized <= 0 ? '   <- no edge; do not take the bet' : ''),
  );
}
console.log('  If the true p is 0.55 and you sized for 0.60, you are betting twice the optimum.');
