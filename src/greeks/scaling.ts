/**
 * Explicit unit conversions for Greeks.
 *
 * The core always returns raw units — vega per 1.00 of volatility, theta per year, rho per 1.00
 * of rate. Scaling lives here, in functions whose names state the unit they produce, and nowhere
 * else. There is no options object, no global setting and no runtime switch.
 *
 * The reason is that a scaled number is indistinguishable from an unscaled one. `theta = -4.31`
 * could be per year or per day; which it is would depend on a configuration value set somewhere
 * else entirely, and a reader of the calling code could not tell. `thetaPerCalendarDay(theta)`
 * cannot be misread.
 */

/** Calendar days per year, used by {@link thetaPerCalendarDay}. */
const CALENDAR_DAYS_PER_YEAR = 365;

/** Percentage points per unit, used by the two per-percentage-point helpers. */
const PERCENTAGE_POINTS_PER_UNIT = 100;

/** Conventional number of trading days per year, the default for {@link thetaPerTradingDay}. */
export const DEFAULT_TRADING_DAYS_PER_YEAR = 252;

/**
 * Converts vega from per 1.00 of volatility to per percentage point.
 *
 * This is the number most trading screens display: the change in option value for a move of one
 * volatility point, for example from 20% to 21%.
 *
 * @param vega - Vega in raw units, per 1.00 of volatility.
 * @returns Vega per percentage point of volatility.
 *
 * @example
 * ```ts
 * vegaPerPercentagePoint(12.1052); // 0.121052
 * ```
 */
export function vegaPerPercentagePoint(vega: number): number {
  return vega / PERCENTAGE_POINTS_PER_UNIT;
}

/**
 * Converts theta from per year to per calendar day.
 *
 * Calendar-day theta spreads decay evenly across all 365 days, including weekends. It is the
 * right convention when the position is marked every calendar day.
 *
 * @param theta - Theta in raw units, per year.
 * @returns Theta per calendar day.
 *
 * @example
 * ```ts
 * thetaPerCalendarDay(-4.3054); // -0.011796...
 * ```
 */
export function thetaPerCalendarDay(theta: number): number {
  return theta / CALENDAR_DAYS_PER_YEAR;
}

/**
 * Converts theta from per year to per trading day.
 *
 * Trading-day theta attributes the whole year's decay to the days the market is open, so it is
 * larger in magnitude than the calendar-day figure. Which convention is correct is a modelling
 * choice about the position being measured; this library will not pick one silently.
 *
 * @param theta - Theta in raw units, per year.
 * @param tradingDaysPerYear - Trading days in a year, defaulting to
 *        {@link DEFAULT_TRADING_DAYS_PER_YEAR}.
 * @returns Theta per trading day.
 * @throws RangeError if `tradingDaysPerYear` is not a positive finite number.
 */
export function thetaPerTradingDay(
  theta: number,
  tradingDaysPerYear: number = DEFAULT_TRADING_DAYS_PER_YEAR,
): number {
  if (!Number.isFinite(tradingDaysPerYear) || tradingDaysPerYear <= 0) {
    throw new RangeError(
      `tradingDaysPerYear must be a positive finite number, received ${String(tradingDaysPerYear)}`,
    );
  }
  return theta / tradingDaysPerYear;
}

/**
 * Converts rho from per 1.00 of rate to per percentage point.
 *
 * @param rho - Rho in raw units, per 1.00 of rate.
 * @returns Rho per percentage point of rate, for example a move from 5% to 6%.
 */
export function rhoPerPercentagePoint(rho: number): number {
  return rho / PERCENTAGE_POINTS_PER_UNIT;
}
