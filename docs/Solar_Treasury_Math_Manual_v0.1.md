**SOLAR TREASURY**

Math Manual

*v0.1 - Capital routing, harvest, refill, output, and sizing*

| **Purpose:** Make the Solar Treasury calculable. The metaphor describes the structure; this manual defines the numbers underneath it. The objective is not to predict markets precisely. It is to constrain capital movement so that gains can be harvested, losses cannot demand unlimited rescue, and internal production can be measured honestly. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

| **Important:** This is a design framework and experiment, not a promise of investment returns. Fees, taxes, dilution, slippage, distributions, liquidity, and changing fundamentals must be included in live implementation. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

**Core rule: bands decide WHEN; mass math decides HOW MUCH; thesis state decides WHETHER.**

# 0. Quick Reference

The minimum useful state for any investable body is below. If Binder cannot compute these fields, it should not automate that body.

| **Field**             | **Symbol** | **Meaning**                                                               |
|-----------------------|------------|---------------------------------------------------------------------------|
| Working Mass          | M          | Desired deployed dollar value for the body.                               |
| Current Mass          | C          | Current market value of the position.                                     |
| Current Valuation     | V          | Current market cap, share price, or other execution/valuation coordinate. |
| Anchor Valuation      | V0         | Valuation at which the working plan is anchored.                          |
| Thesis Horizon        | VH         | Valuation the thesis says is plausible if the setup works.                |
| Local Reserve         | R          | Harvested or pre-authorized cash available to this body/subsystem.        |
| External Contribution | E          | Lifetime money supplied from outside the body/system.                     |
| Lifetime Harvest      | H          | Realized capital removed from the body before later routing.              |
| Thesis State          | S          | Thriving / healthy / uncertain / deteriorating / broken.                  |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Mass Coverage<br />
Coverage = C / M</strong></p>
<p>How much of the desired working body exists right now. 1.00 means current mass equals working mass.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Mass Horizon<br />
VH_mass = V x (M / C)</strong></p>
<p>Valuation required for the current position to grow into Working Mass without adding new capital.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Required Seed Mass<br />
Seed = M x (V / Thesis Horizon)</strong></p>
<p>How much capital needs to be deployed now for the position to reach Working Mass at the thesis valuation, assuming simple proportional price movement.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Harvestable Excess<br />
Excess = max(0, C - M)</strong></p>
<p>The maximum amount above Working Mass that could be removed if a harvest gate is active.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Refill Deficit<br />
Deficit = max(0, M - C)</strong></p>
<p>How much mass is missing. This does NOT authorize a refill by itself.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 1. The Three Ledgers

Do not collapse all performance into one number. The system needs three ledgers because each answers a different question.

**Market Value Ledger** - What is everything worth right now? This is allowed to fall.

**Contribution Ledger** - How much outside capital has actually been supplied? This prevents repeated top-ups from masquerading as performance.

**Production Ledger** - How much realized, net output has the system actually created? This should exclude paycheck contributions and unrealized gains.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Economic Result<br />
Economic Result = Current Value + Lifetime Harvest - External Contributions</strong></p>
<p>At the body level, this is the simplest anti-self-deception check. Add fees/taxes separately or use net values consistently.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Example:** A high-yield fund received \$1,000, distributed \$500, and is now worth \$400. Economic Result = \$400 + \$500 - \$1,000 = -\$100. The \$500 payout did not create \$500 of wealth. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 2. Working Mass

Working Mass is the desired amount of capital deployed in a persistent body. It is a dollar target, not a share-count target and not necessarily a percentage target.

- Use current dollar value to measure Current Mass.

- Use shares/units only as inventory underneath that mass.

- Use percentages as system-level risk/concentration guardrails.

- Working Mass may be promoted in tiers, but a price increase alone does not authorize promotion.

| **Separation of jobs:** Dollar targets drive local shuttles. Percentages monitor systemic concentration. Share counts record inventory. |
|-----------------------------------------------------------------------------------------------------------------------------------------|

# 3. Mass Horizon and Seed Sizing

Mass Horizon measures optionality. It answers: if I add no more money, at what valuation does this position naturally become a full Working-Mass body?

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Mass Horizon<br />
Mass Horizon = Current Valuation x (Working Mass / Current Mass)</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Position** | **Current Mass** | **Current MC** | **Working Mass** | **Mass Horizon** |
|--------------|------------------|----------------|------------------|------------------|
| A            | \$45             | \$10,000       | \$1,000          | ~\$222,222 MC    |
| B            | \$400            | \$100,000      | \$1,000          | \$250,000 MC     |
| C            | \$100            | \$100,000      | \$1,000          | \$1,000,000 MC   |

Interpretation: A and B look radically different by dollars deployed, yet both become \$1,000 bodies at roughly the same market-cap neighborhood. A uses little seed capital and requires much more convexity; B uses more capital and requires less appreciation.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Required Seed Mass<br />
Required Seed = Working Mass x (Current Valuation / Thesis Horizon)</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Example:** Current market cap = \$10k, thesis horizon = \$250k, desired Working Mass = \$1,000. Required seed = \$1,000 x (\$10k / \$250k) = \$40. If \$45 is already deployed, the body is already sufficiently seeded for that thesis horizon; adding more is not mathematically required. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 4. Anchor, Rings, and Hysteresis

An Anchor is the valuation around which a construction or maintenance plan is defined. Rings are percentage or volatility-based thresholds that wake the engine up. The system should usually ignore movement inside the rings.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Fixed Ring Price/Valuation<br />
Upper Ring = Anchor x (1 + u) | Lower Ring = Anchor x (1 - d)</strong></p>
<p>u and d are chosen thresholds. For a memecoin, these may be intentionally wide.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Illustrative high-volatility ring schedule:

| **Move from Anchor**               | **Engine State** | **Typical Meaning**                                           |
|------------------------------------|------------------|---------------------------------------------------------------|
| +25%                               | Sleep / observe  | Normal noise for a very volatile body.                        |
| +50%                               | Harvest ring 1   | First meaningful excess extraction.                           |
| +100%                              | Harvest ring 2   | Recover substantial capital / restore mass.                   |
| +200% or unexplained vertical move | Overharvest      | Price is outrunning explainable thesis.                       |
| -25%                               | Sleep / observe  | No reflex refill.                                             |
| -40% to -50%                       | Low orbit        | First serious refill consideration if thesis remains healthy. |
| -60% or worse                      | Deep orbit       | Only use pre-authorized reserve; reassess thesis first.       |

| **Hysteresis:** Use different thresholds for selling and buying back. Harvest relatively easily on the way up; require a much larger reset before reentry. This reduces buy-sell churn and prevents immediate round-trips. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 5. Harvest Math

The cleanest default harvest rule is based on excess mass, not an arbitrary percentage of shares.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Full Reset Harvest<br />
Harvest = max(0, C - M)</strong></p>
<p>When a harvest ring is crossed, remove enough dollar value to restore the body to Working Mass.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Partial Harvest<br />
Harvest = alpha x max(0, C - M)</strong></p>
<p>alpha is a policy fraction from 0 to 1. Example: alpha = 0.5 removes half of the excess and leaves more upside exposure.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Illustrative example:

- Anchor market cap: \$100k.

- Initial deployed mass: \$750.

- Authorized Working Mass: \$1,000.

- Market cap rises +50% to \$150k, so \$750 becomes \$1,125.

- Excess above Working Mass = \$125.

- Full-reset harvest removes \$125 and leaves a \$1,000 position.

After that harvest, the position owns fewer units. If market cap later returns to the \$100k anchor, the remaining position is worth about \$666.67 rather than the original \$750. That is not a failure; the missing value was converted into realized cash at the higher valuation.

# 6. Refill Math

A deficit is a measurement, not a command. A refill occurs only when the market is in an authorized low ring AND the thesis gate allows it.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Refill Deficit<br />
Deficit = max(0, M - C)</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Maximum Refill<br />
Refill = min(Deficit, Ring Tranche, Local Reserve + Authorized New Capital)</strong></p>
<p>If thesis state blocks refill, Refill = $0 regardless of the deficit.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **No rescue rule:** A falling body cannot acquire unlimited rights to Treasury capital simply because its Current Mass is below Working Mass. |
|-----------------------------------------------------------------------------------------------------------------------------------------------|

Continuing the \$750 / \$100k example:

- Initial undeployed reserve = \$250.

- Harvest at \$150k MC = \$125.

- Local available cash = \$375.

- When MC returns to \$100k, remaining position value is about \$666.67.

- Deficit to \$1,000 Working Mass = about \$333.33.

- If thesis is healthy and the low-ring rule permits it, refill \$333.33.

- Result: approximately \$1,000 deployed again plus ~\$41.67 left in reserve.

# 7. Thesis Gate

Price tells the engine where the body is. Evidence tells the engine what the body is. The capital action comes from the intersection.

| **Thesis State** | **Below Low Orbit** | **Inside Orbit**   | **Above High Orbit** |
|------------------|---------------------|--------------------|----------------------|
| Thriving         | Refill eligible     | Hold / add by plan | Harvest selectively  |
| Healthy          | Refill eligible     | Hold               | Harvest              |
| Uncertain        | No automatic refill | Observe            | Overharvest bias     |
| Deteriorating    | No refill           | Reduce / freeze    | Harvest / reduce     |
| Broken           | Exit / contain      | Exit               | Exit                 |

| **Asymmetry:** Uncertainty increases extraction and decreases replenishment. A mysterious pump is a reason to harvest more, not a reason to believe more. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------|

# 8. Stocks and ETFs: How to Set Rings

Memecoins can use market-cap rings directly because market cap is often the most intuitive valuation coordinate. Stocks and ETFs need narrower, volatility-aware rings.

## Method A - Simple asset classes

- Broad-market ETF: relatively narrow bands.

- Sector ETF: wider bands.

- High-beta single stock: wider again.

- Development/speculative stock: very wide bands.

- Exact percentages should be tuned from live history, not hard-coded globally.

## Method B - Volatility-normalized rings

For a chosen decision horizon h trading days, estimate annualized realized volatility sigma_ann. Convert it to expected horizon volatility:

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Horizon Volatility<br />
sigma_h = sigma_ann x sqrt(h / 252)</strong></p>
<p>Example: use h = 21 for roughly one trading month. Then set rings at a chosen multiple k of sigma_h.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Volatility Ring<br />
Ring Width = k x sigma_h</strong></p>
<p>k is a policy choice. The objective is not statistical perfection; it is to make a ring mean "unusual for this asset" rather than using one percentage for everything.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Stock valuation coordinate:** Use share price for execution. For thesis work, market capitalization or enterprise value may be more meaningful, especially when dilution, buybacks, splits, or capital structure matter. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 9. Moon Math: Output Instead of Fixed Mass

Some Moons have a different job from their Planet. An income Moon can be sized around a monthly production target rather than a fixed dollar mass.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Required Moon Mass<br />
Required Moon Mass = Monthly Production Goal / Conservative Monthly Production Rate</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Production Coverage<br />
Coverage = Actual Conservative Monthly Production / Monthly Production Goal</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Guardrail:** A falling payout does not automatically authorize more capital. Every output Moon needs a Maximum Moon Mass. If the capital required to restore the output goal exceeds the cap, the system reports underproduction instead of buying more. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

Example: monthly goal = \$25. Conservative net monthly production rate = 1.5%. Required Moon Mass = \$25 / 0.015 = about \$1,667. If Maximum Moon Mass is \$1,750, the goal is still feasible. If the rate deteriorates to 1.0%, the required mass becomes \$2,500 and the engine must refuse the refill.

## Planet-Moon reciprocity

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Net Local Export<br />
Net Local Export = Moon-to-Planet Transfers - Planet-to-Moon Transfers</strong></p>
<p>Positive values mean the Moon has been a net supporter of its Planet.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Support Ratio<br />
Support Ratio = Moon-to-Planet Transfers / max(Planet-to-Moon Transfers, epsilon)</strong></p>
<p>Use a small epsilon or display "no support required" when the denominator is zero. Do not let division by zero produce fake infinity.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 10. Outposts, Comets, and Persistent Bodies

## Outpost

An Outpost is built over time toward a fixed external-contribution cap. Ordinary price declines do not accelerate its build schedule.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Construction Progress<br />
Progress = Cumulative External Contributions / Authorized Build Cap</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Next Brick<br />
Next Brick = min(Scheduled Brick, Authorized Build Cap - Contributions to Date)</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Outpost rule:** If Spotlight arrives early or the thesis changes materially, pause construction and reassess before laying another brick. |
|---------------------------------------------------------------------------------------------------------------------------------------------|

## Comet

A Comet is temporary. It has no persistent Working Mass. Its successful end state is zero position.

- Maximum deployed capital.

- Predefined loading stages.

- Harvest ladder.

- Expiration/event window.

- Full-exit rule.

- No ordinary low-orbit refill after the loading phase closes.

# 11. Production, Siphoning, and the Daily Deposit

The motivating number should be realized production, not share price or unrealized portfolio value.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Gross Internal Output<br />
Gross Output = Realized Harvests + Net Distributions + Net TCG Profit + Other Realized System Income</strong></p>
<p>Exclude paycheck deposits and other outside contributions.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Free Harvest<br />
Free Harvest = Gross Output - Tax Reserve - Required Local Maintenance - Required Reserve Funding</strong></p>
<p>Only Free Harvest is eligible for siphoning to Pocket or discretionary expansion.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Citizen Dividend<br />
Pocket Allocation = Siphon Rate x Free Harvest</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Smoothed Daily Deposit<br />
Daily Deposit = Pocket Allocation for Period / Number of Days in Next Payout Period</strong></p>
<p>A reservoir can smooth irregular production into a boring daily drip.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Do not force daily trading:** The system may pay daily without earning daily. Production can arrive irregularly; the reservoir smooths it. Never invent trades merely to make Tuesday produce a number. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 12. System-Level Growth Metrics

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Civilization Yield<br />
TTM Civilization Yield = Trailing-12-Month Free Harvest / Average Civilization Value</strong></p>
<p>This is a realized-output metric, not a guaranteed forward yield.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Internal Share of Expansion<br />
Internal Share = Retained Internal Production / (External Contributions + Retained Internal Production)</strong></p>
<p>Shows how much new working capital is being supplied by the system itself rather than by paychecks.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Capital Recovery Ratio<br />
Capital Recovery = Permanently Exported Net Harvest / Lifetime External Contributions</strong></p>
<p>At 100%, the system has exported an amount equal to all outside capital originally supplied, while current assets may still remain.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Suggested milestone language:

- First heartbeat: internal production exists.

- Productive: rolling output is noticeable.

- Self-funding crossover: retained internal production equals or exceeds outside contributions.

- Citizen-dividend crossover: Pocket output equals or exceeds the amount you choose to contribute from pay.

- Habitable: a body maintains its role without repeated emergency rescue.

- Productive: a body exports meaningful surplus.

- Self-sustaining: a body has recovered most or all external contribution while retaining useful Working Mass.

# 13. Tax Reserve and Net Output

Tax money is not investable surplus. Live implementation should reserve it before calculating Free Harvest.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Provisional Tax Reserve<br />
Tax Reserve = Estimated Taxable Realized Profit x Reserve Rate</strong></p>
<p>The reserve rate is user-specific and must not be assumed globally. Loss carryforwards, holding periods, jurisdiction, and withholding all matter.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **Accounting principle:** The big motivational counter should be after-tax-ish output whenever possible. Otherwise the system can celebrate money that is already spoken for. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 14. The Shadow-Sun Benchmark

The system needs a control group so complexity cannot hide underperformance. Track what would have happened if the same external investment deposits had simply bought a broad-market benchmark.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Benchmark Contribution<br />
Synthetic Shares Added = External Deposit / Benchmark Price on Deposit Date</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Shadow Value<br />
Shadow Value = Total Synthetic Benchmark Shares x Current Benchmark Price</strong></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>Active-System Gap<br />
Gap = (Current Civilization Value + Permanently Siphoned Value) - Shadow Benchmark Value</strong></p>
<p>Use consistent treatment of withdrawals, taxes, and cash when comparing. The benchmark exists to expose whether the machinery is actually adding value.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 15. Minimum Decision Algorithm

A simple implementation can run the following sequence whenever a body crosses a meaningful ring or reaches settlement.

1.  Update current valuation, current mass, units, and reserve balances.

2.  Update thesis state from fundamentals/evidence. Do not infer thesis health from price alone.

3.  Check whether a market ring has been crossed. If not, do nothing.

4.  If above an upper ring, calculate excess mass and the applicable harvest coefficient.

5.  If below a lower ring, calculate the deficit, but do not refill until thesis and capital-cap gates approve it.

6.  Apply local reserve and maximum-contribution limits.

7.  Reserve taxes on realized taxable production.

8.  Route Free Harvest according to local retention, Treasury, and Pocket policy.

9.  Write every movement to the ledger with source, destination, amount, reason, and timestamp.

10. Recompute system-level risk/concentration and compare to the Shadow Sun.

# 16. Worked Example: A High-Volatility Body

This is a deliberately simplified example to show how the pieces connect. It ignores fees, slippage, taxes, dilution, and liquidity.

| **Stage**           | **Market Cap** | **Position / Cash**                 | **Engine Action**                                                  |
|---------------------|----------------|-------------------------------------|--------------------------------------------------------------------|
| Start               | \$100k         | \$750 position + \$250 reserve      | Anchor established; \$1,000 authorized Working Mass.               |
| +50%                | \$150k         | \$1,125 position + \$250 reserve    | Harvest \$125 excess; position returns to \$1,000.                 |
| After harvest       | \$150k         | \$1,000 position + \$375 reserve    | System has fewer units but more realized cash.                     |
| Back to anchor      | \$100k         | ~\$666.67 position + \$375 reserve  | Low-orbit rule may wake depending on configured band.              |
| Refill approved     | \$100k         | \$1,000 position + ~\$41.67 reserve | Refill ~\$333.33; only because thesis gate permits it.             |
| If thesis uncertain | any            | No automatic refill                 | Reserve stays safe; upside events are harvested more aggressively. |

# 17. What Binder Should Display

The user should not have to perform these calculations mentally. A body detail view can expose only the outputs that matter.

| **Displayed Metric**            | **Example**                                          |
|---------------------------------|------------------------------------------------------|
| Working Mass                    | \$1,000                                              |
| Current Mass                    | \$742                                                |
| Coverage                        | 74.2%                                                |
| Anchor                          | \$100k market cap                                    |
| Mass Horizon                    | \$134.8k market cap                                  |
| Thesis Horizon                  | \$250k market cap                                    |
| Required Seed at Thesis Horizon | \$400                                                |
| Low Ring                        | \$55k market cap                                     |
| Next Harvest Ring               | \$150k market cap                                    |
| Local Reserve                   | \$188                                                |
| Lifetime External Contribution  | \$750                                                |
| Lifetime Harvest                | \$325                                                |
| Economic Result                 | Current + harvested - contributed                    |
| Thesis State                    | Healthy                                              |
| Next Allowed Action             | None / refill eligible / harvest eligible / evacuate |

# 18. Design Principles to Keep

- Never let a deficit authorize capital by itself.

- Never let a headline distribution substitute for economic return.

- Never count paycheck deposits as internal production.

- Never let a temporary Comet quietly become permanent Working Mass.

- Never let a failing Moon drain a healthy Planet automatically.

- Use wide no-action zones so automation reduces decisions rather than multiplying them.

- Use local reserves to recycle volatility; use the Vault/Treasury to make successful extraction real.

- Let percentages supervise concentration, but let dollar Working Mass drive local movement.

- For speculative positions, use thesis horizon and Mass Horizon to avoid over-seeding optionality.

- Benchmark the active system against a boring alternative so complexity must justify itself.

| **One-line summary:** Price/valuation rings decide WHEN. Working-Mass math decides HOW MUCH. Thesis state decides WHETHER. Reserves decide FROM WHERE. Production accounting decides WHAT ACTUALLY COUNTED. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# Appendix A. Symbols

| **Symbol** | **Definition**                        |
|------------|---------------------------------------|
| M          | Working Mass                          |
| C          | Current Mass                          |
| V          | Current valuation coordinate          |
| V0         | Anchor valuation                      |
| VH         | Thesis Horizon                        |
| R          | Local Reserve                         |
| E          | Lifetime External Contributions       |
| H          | Lifetime Harvest                      |
| u          | Upper-ring percentage                 |
| d          | Lower-ring percentage                 |
| alpha      | Harvest fraction of excess            |
| sigma_ann  | Annualized realized volatility        |
| sigma_h    | Volatility scaled to decision horizon |
