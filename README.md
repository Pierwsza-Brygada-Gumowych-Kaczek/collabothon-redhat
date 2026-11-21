# Duck CFO — Autonomous CFO for SMEs

> An AI-powered CFO assistant for small business owners. It watches the company's bank account, spots financial risks before they hurt, and explains — in plain English — what to do next. The owner always stays in control.

Built for the **Collabothon 2026 · Commerzbank × Red Hat "Autonomous CFO"** challenge. The solution is designed to run on **Red Hat OpenShift AI**, using an open-weights language model served there.

---

## The problem

Small and medium-sized enterprises are usually run by an owner who is also the finance department. There is no CFO, so:

- financial management eats time that should go into running the business,
- important details get overlooked — a cash dip before payday, a tax prepayment due next week, a currency exposure nobody hedges, idle cash earning nothing,
- the owner is rarely a finance expert, so even good advice is hard to understand and act on.

## The solution

Duck CFO is an **agentic CFO assistant**. It reads the company's bank statement and runs specialised agents. Each one turns raw transactions into a clear, explainable recommendation for a non-expert:

| Agent | What it does | Typical output |
|---|---|---|
| **Liquidity agent** | Forecasts the account balance N days ahead from recurring income, costs and scheduled payments | Warns about a coming cash shortfall and proposes a suitable credit facility |
| **FX hedging agent** | Finds currency risk from foreign-currency payments (e.g. CHF loan instalments) | Proposes hedges using Commerzbank products |
| **Tax agent** | Builds a schedule of advance tax payments | Recommends prepayment amounts and legal optimisation opportunities |
| **Investment agent** | Looks at the liquidity that is really free to invest | Suggests fixed-term deposits, money-market funds or capex financing |

Alongside the agents, the app shows the balance forecast, transactions, monthly summaries, spending categories and savings goals, so the owner sees the full picture.

### Demo business

The demo account is **Vincenzo Amalfi / Pizzeria Amalfi**, a restaurant with a full year of 2025 transactions: seasonal revenue, rent, suppliers, payroll and CHF-denominated loan instalments. This gives every agent something realistic to find.

---

## How it works: facts vs. AI

The key design decision is a strict split between **numbers** and **words**:

```
 bank statement
        │
        ▼
 1. ANALYSE      deterministic code computes the hard facts:
                 balances, cash-flow forecast, tax amounts, CHF exposure
        │
        ▼
 2. RECOMMEND    the facts go to the language model on OpenShift AI,
                 which writes the summary and recommendations
        │
        ▼
 3. EXPLAIN      the UI shows the facts, the recommendation, the reasoning,
                 risk and difficulty — and who produced each part
        │
        ▼
 4. DECIDE       the business owner reviews it and decides what to do
```

- **Agents analyse independently** — all figures come from deterministic code over the real statement. The model never invents balances or tax amounts.
- **Agents recommend** — the model only writes the interpretation and proposals, in plain language, with cautious ranges and no promised returns.
- **The owner decides** — the prototype is read-only. Nothing moves money or signs a product, so every action is a recommendation the owner chooses to follow.
- **Transparent about the source** — the UI always shows whether a result comes from the real AI model, from clearly labelled demo content (used only while no model is connected), or whether the model was unavailable. In the last case the calculated facts are still shown and no recommendations are invented.

This keeps the assistant explainable and auditable, and understandable for owners with any level of technical confidence — in the spirit of the hackathon theme "Innovations for all generations".

---

## Roadmap

- Approval workflow: the owner approves a recommendation and a **simulated** execution (e.g. opening a credit line, placing a hedge) is recorded, clearly labelled as simulated vs. permitted.
- Per-agent autonomy levels: analyse only / recommend / act after approval.
- Agent tracing and evaluation, guardrails, and orchestration of agents.

## License

See [LICENSE](LICENSE).
