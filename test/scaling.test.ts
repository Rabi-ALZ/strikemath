import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRADING_DAYS_PER_YEAR,
  rhoPerPercentagePoint,
  thetaPerCalendarDay,
  thetaPerTradingDay,
  vegaPerPercentagePoint,
} from '../src/greeks/scaling.js';
import { callGreeks } from '../src/greeks/analytical.js';

describe('unit conversions', () => {
  it('converts vega to per percentage point', () => {
    expect(vegaPerPercentagePoint(12.1052)).toBeCloseTo(0.121052, 15);
  });

  it('converts rho to per percentage point', () => {
    expect(rhoPerPercentagePoint(8.9)).toBeCloseTo(0.089, 15);
  });

  it('converts theta to per calendar day using 365 days', () => {
    expect(thetaPerCalendarDay(-365)).toBe(-1);
    expect(thetaPerCalendarDay(-4.3054)).toBeCloseTo(-4.3054 / 365, 15);
  });

  it('converts theta to per trading day using 252 days by default', () => {
    expect(DEFAULT_TRADING_DAYS_PER_YEAR).toBe(252);
    expect(thetaPerTradingDay(-252)).toBe(-1);
    expect(thetaPerTradingDay(-4.3054)).toBeCloseTo(-4.3054 / 252, 15);
  });

  it('accepts an explicit trading-day count', () => {
    expect(thetaPerTradingDay(-250, 250)).toBe(-1);
  });

  it('rejects a nonsensical trading-day count rather than returning Infinity', () => {
    expect(() => thetaPerTradingDay(-1, 0)).toThrow(RangeError);
    expect(() => thetaPerTradingDay(-1, -252)).toThrow(RangeError);
    expect(() => thetaPerTradingDay(-1, Number.NaN)).toThrow(RangeError);
  });
});

describe('the conversions are the only place scaling happens', () => {
  it('leaves the core returning raw units', () => {
    // Hull chapter 17: vega is 12.1052 per 1.00 of volatility. A screen would show 0.121052.
    // If the core ever started returning the scaled number, this assertion would catch it.
    const greeks = callGreeks({
      spot: 49,
      strike: 50,
      timeToExpiry: 0.3846,
      riskFreeRate: 0.05,
      volatility: 0.2,
      dividendYield: 0,
    });

    expect(greeks.vega).toBeCloseTo(12.1052, 4);
    expect(vegaPerPercentagePoint(greeks.vega)).toBeCloseTo(0.121052, 6);

    expect(greeks.theta).toBeCloseTo(-4.3054, 4);
    expect(thetaPerCalendarDay(greeks.theta)).toBeCloseTo(-0.0117956, 6);
    expect(thetaPerTradingDay(greeks.theta)).toBeCloseTo(-0.0170849, 6);
  });

  it('is a pure division, so converting back recovers the raw value', () => {
    const raw = 12.1052;
    expect(vegaPerPercentagePoint(raw) * 100).toBeCloseTo(raw, 12);
    expect(thetaPerCalendarDay(raw) * 365).toBeCloseTo(raw, 12);
    expect(thetaPerTradingDay(raw) * 252).toBeCloseTo(raw, 12);
    expect(rhoPerPercentagePoint(raw) * 100).toBeCloseTo(raw, 12);
  });
});
