**Project Name**
*Enter the name of your project.*

Duck CFO

---

**One-Line Summary**
*Describe what your project does and who it helps in one clear sentence. Maximum 200 characters.*

Duck CFO is an AI-powered CFO assistant that reads a small business's bank statement and gives its owner explainable liquidity, tax, investment, FX and savings-goal recommendations.

---

**Technology Stack**
*List the languages, frameworks, platforms, APIs, cloud services and hardware used in your project.*

Python, TypeScript, HTML/CSS, SQL, YAML, FastAPI, Pydantic, SQLAlchemy, Angular 19, RxJS, Lucide icons (plain SVG charts), Red Hat OpenShift, Red Hat OpenShift AI (KServe, vLLM), Docker, nginx, GitHub, PostgreSQL 16 (production), SQLite (local and tests), OpenAI-compatible chat API (from vLLM), own REST/JSON API, Llama 3.2 3B Instruct (open weights), Qwen3-8B FP8 (open weights), NVIDIA GPU (single-node cluster, 32 CPU, 128 GB RAM)

---

**Project Overview**

**THE PROBLEM**
*What problem are you addressing? Who experiences it, and why is it important to solve?*

Owners of small and medium businesses usually manage the company's finances themselves, without a CFO. Financial management takes time away from running the business, and important details are easy to miss: a thin cash buffer in a quiet month, tax prepayments that are too low, currency risk, or idle cash. These owners are not finance experts, so jargon-heavy advice does not help them. Solving this matters because small mistakes in cash and tax planning can threaten a business that is otherwise healthy.

**YOUR SOLUTION**
*How does your project address this problem? Describe the core idea and what makes it unique, useful or innovative.*

Duck CFO is an agentic CFO assistant. It reads the company's bank statement, calculates the facts deterministically (balances, forecasts, tax figures, currency exposure) and then asks a language model on OpenShift AI to explain them and recommend next steps in plain language. Four specialised agents cover the use cases of the challenge:

- **Liquidity:** forecasts cash flow and proposes credit facilities.
- **Tax:** checks advance payments and finds legal savings.
- **Investment:** recommends deposits, money market funds and financing of equipment.
- **FX hedging:** finds currency risk and proposes hedges.

What makes it different is the split of work. The numbers are calculated by code, and the model only chooses and explains. Every recommendation shows its reasoning in simple words, so the owner stays in control. We added savings goals, where the AI proposes several ways to reach a goal and the app compares them with plain regular saving.

**THE WORKING PROTOTYPE**
*What can users do with your project today? Walk us through the main features and distinguish what is already implemented and working.*

Users sign in (demo account `demo` / `demo`) and can:

- **Overview:** see the balance, a hover-able balance forecast, short summaries from all four agents and their savings goals.
- **Analytics and Transactions:** browse the daily balance, monthly money in and out, spending by category, and the full transaction list.
- **Allocation:** see a donut chart of how the money is divided between goals, spending categories (from the statement) and free cash. It updates as goals change.
- **Liquidity, Tax, Investments, FX hedging:** open each agent for its explained recommendations: credit facilities, an advance tax payment plan with "up to" savings per tip, investment proposals including equipment financing, and currency hedges.
- **Goals:** create a goal with a target, amount saved, optional deadline, icon and own picture. The AI proposes ways to reach it as tiles showing the payment, time to goal, interest and risk. Each is compared with plain saving, and a warning appears if the user adds money they do not have. Goal payments also reduce the cash forecast.
- **Account and settings:** edit the profile, change the password, switch light/dark theme and check the AI connection.

When the model is not reachable, the app switches to clearly labelled demo content instead of failing. When it is reachable, answers come from the model. Everything above is implemented and runs on OpenShift.

**BEHIND THE BUILD**
*Explain how the key components work together and the technical decisions that shaped the implementation. Identify existing tools, libraries, services or codebases you built upon, and what your team created during the hackathon.*

A FastAPI backend reads transactions from the database (PostgreSQL on OpenShift, SQLite locally). Fact-calculation code builds an overview, a cash-flow forecast, tax figures and FX exposure. Each agent sends these facts to the model on OpenShift AI through an OpenAI-compatible API (vLLM via KServe) and asks for strict JSON. The backend validates the reply and calculates the numbers shown to users. Examples are the time to reach a goal and the interest, which come from deterministic formulas and not from the model. An Angular 19 frontend renders the pages and hand-written SVG charts, and nginx serves it and proxies `/api`. Everything runs as containers on OpenShift, with images built from the GitHub repository.

Key decisions:

- **Calculated numbers, AI explanations.** This keeps the figures verifiable.
- **Demo fallback.** The app stays usable when the model is down.
- **Caching.** Per-user caching of AI answers avoids repeated model calls.
- **Strict JSON handling.** Replies are validated before they are shown.

Built on existing tools: FastAPI, Pydantic, SQLAlchemy, Angular, RxJS, Lucide icons, PostgreSQL, nginx, vLLM and OpenShift AI, plus open-weights models (Llama 3.2 3B, Qwen3-8B). The application code, agents, prompts, forecast and tax logic, goals engine, charts and deployment manifests were created by our team during the hackathon.

**CHALLENGES AND DISCOVERIES**
*What challenges did you encounter? What approaches did you try, and what did you learn?*

- **Model deployment on one node.** Our first model deployments failed (a 30B vision-language model and a Granite variant) because they did not fit the node's memory and GPU. We learned to pick small, quantized text models and to shorten the context length.
- **Model name mismatch.** The model server answered 200 on `/v1/models` but 404 on chat requests, because the configured model name did not match the served name. We added a status view of the served model names to spot this quickly.
- **OpenShift gateway timeout.** Slower AI answers exceeded the 30-second default route timeout and caused random errors. We raised the timeout and stopped one slow agent from showing a page-wide error.
- **Deployment details.** A password containing `@` broke the database URL, service names generated by the console did not match what nginx expected, and pods do not pull code from GitHub by themselves (a new build is needed).
- **Reliability of small models.** Small models sometimes return weak or invalid JSON. We validate replies, drop unusable proposals (such as ones that never reach the goal or save €0) and fall back to demo content.
- **Rounding bug.** Goal plans with a deadline were one month late until we rounded payments up.

**RESULTS AND NEXT STEPS**
*What did you achieve, and how did you validate or test it? Share the outcome you are most proud of, current limitations and what you would improve next.*

We delivered an end-to-end CFO assistant with all four agents, savings goals with AI proposals and a baseline comparison, an allocation view, forecasts that include goal payments, and account settings. It runs on an OpenShift AI cluster with a model served by vLLM. We validated it with 34 automated backend tests (with a mocked model) and by building the frontend, and by running it on the cluster. What we are most proud of is the clear separation between calculated facts and AI explanations, which makes the output explainable.

Current limitations:

- The data is a sample bank statement, with no live bank connection.
- Amounts saved in goals are entered manually.
- Credit, deposit and hedging products are indicative, and no recommendation can be executed or approved inside the app yet.
- Cached AI answers live in the backend's memory.

Next steps:

- A simulated approval workflow that separates what the agents analyse, recommend and what needs the owner's approval.
- Real account data through a bank API.
- Agent tracing and evaluation (for example MLflow) and guardrails.
- Larger models on the GPU and a browser-based end-to-end test suite.

---

**Source Code Repository**
*Provide a link to the source code repository.*

https://github.com/Pierwsza-Brygada-Gumowych-Kaczek/collabothon-redhat
