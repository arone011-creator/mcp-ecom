# 📚 Documentation Index

Complete guide to all documentation in this project.

## 📁 Repository Layout

This is a multi-service repository. The root holds only cross-service files;
every deployable service lives under `apps/` and is self-contained.

| Path | What it is |
|------|------------|
| `apps/web/` | The Next.js storefront and `/api/v1` REST API. Its own `package.json`, `node_modules`, tests, Prisma schema and scorecard. **Run npm commands from here.** |
| `docs/` | Everything in this index, plus the milestone plans |
| `docs/mcp/` | The MCP server and agentic layer: phase docs, tool surface, open risks |
| `docs/TECHNICAL_SNAPSHOT.txt` | One-document overview of the whole system, technical and plain-language |
| `docs/ITERATIONS.txt` | The build history: what worked, what failed, and how to rebuild it |
| `docs/PLAN_M4_STOREFRONT.txt` | The plan for the next milestone — this repo's half of the agent work |
| `Makefile` | Repo-level entry point; each target delegates into `apps/web` |
| `docker-compose.yml` | Local Postgres + Redis + the web image |

Documents written before this reorganization describe paths such as
`app/`, `components/` and `prisma/` as living at the repository root.
They now live under `apps/web/`; the rest of those documents still holds.

---

## 🗺️ Navigation Guide

**Want the whole picture in one document?**
[TECHNICAL_SNAPSHOT.txt](TECHNICAL_SNAPSHOT.txt) — the complete architecture,
stack, data model, API contract, deployment and known limits as of M3.
Every section carries a plain-language summary, so it works for technical
and non-technical readers alike.

**Want to know how it got built?**
[ITERATIONS.txt](ITERATIONS.txt) — the build history: what worked, what
failed, what the mistakes cost, and a step-by-step recipe for replicating
the whole project from scratch.

**New to the project?** Start here:
1. [../QUICKSTART.md](../QUICKSTART.md) - Get running in 5 minutes
2. [setup/DEV_SETUP.md](setup/DEV_SETUP.md) - Detailed setup instructions
3. [setup/INSTALLATION.md](setup/INSTALLATION.md) - Complete environment setup
4. [contributing/CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) - Quick command reference

**Want to contribute?** Read:
1. [contributing/CONTRIBUTING.md](contributing/CONTRIBUTING.md) - Contribution guidelines
2. [contributing/HUSKY_SETUP.md](contributing/HUSKY_SETUP.md) - Pre-commit hooks setup

**Building the MCP server or the agents?** Everything for that layer is
in [mcp/](mcp/) — start with [mcp/README.md](mcp/README.md):

| Doc | What it covers |
|-----|----------------|
| [mcp/phase-1-mcp-layer.md](mcp/phase-1-mcp-layer.md) | Phase 1 / M3 — the MCP server |
| [mcp/phase-2-single-agent.md](mcp/phase-2-single-agent.md) | Phase 2 / M4 — one agent, full toolbox |
| [mcp/phase-3-multi-agent.md](mcp/phase-3-multi-agent.md) | Phase 3 / M5 — Supervisor + specialists |
| [mcp/tool-surface.md](mcp/tool-surface.md) | The capability map and risk tiers (canonical) |
| [mcp/open-questions.md](mcp/open-questions.md) | Risks carried across phases, and who closes each |
| [mcp/appendix-a-agent-patterns.md](mcp/appendix-a-agent-patterns.md) | Multi-agent pattern reference |

**Understanding the project?** Check:
1. [../README.md](../README.md) - Project overview
2. [TECHNICAL_SNAPSHOT.txt](TECHNICAL_SNAPSHOT.txt) - Architecture and current state
3. [PLAN_M4_STOREFRONT.txt](PLAN_M4_STOREFRONT.txt) - Next milestone plan

---

## 📖 All Documentation Files

### Essential Reading

| File | Purpose | Audience |
|------|---------|----------|
| [README.md](../README.md) | Project overview, features, quick start | Everyone |
| [QUICKSTART.md](../QUICKSTART.md) | Get up and running in 5 minutes | New developers |
| [setup/DEV_SETUP.md](setup/DEV_SETUP.md) | Complete development environment setup | Developers |
| [contributing/CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) | Quick reference for commands and patterns | Developers |

### Contributing

| File | Purpose | Audience |
|------|---------|----------|
| [contributing/CONTRIBUTING.md](contributing/CONTRIBUTING.md) | How to contribute to the project | Contributors |
| [contributing/HUSKY_SETUP.md](contributing/HUSKY_SETUP.md) | Setting up Git pre-commit hooks | Developers |

### Project Information

| File | Purpose | Audience |
|------|---------|----------|
| [TECHNICAL_SNAPSHOT.txt](TECHNICAL_SNAPSHOT.txt) | Full architecture, stack, API contract, deployment, known limits | Everyone |
| [ITERATIONS.txt](ITERATIONS.txt) | Build history: what worked, what failed, how to rebuild | Everyone |
| [PLAN_M4_STOREFRONT.txt](PLAN_M4_STOREFRONT.txt) | Next milestone plan (chat UI, approval gating) | Developers |

### Configuration

| File | Purpose | Audience |
|------|---------|----------|
| [.env.example](../apps/web/.env.example) | Environment variables template | Developers |
| [Makefile](../Makefile) | Development automation commands | Developers |
| [docker-compose.yml](../docker-compose.yml) | Docker services configuration | DevOps |

### Additional Documentation

| File | Purpose | Audience |
|------|---------|----------|
| [setup/INSTALLATION.md](setup/INSTALLATION.md) | Complete environment setup | Developers |
| [setup/DOCKER.md](setup/DOCKER.md) | Docker setup guide | DevOps |
| [superpowers/plans/](superpowers/plans/) | Dated implementation plans for recent milestones | Developers |

---

## 🎯 By Use Case

### "I just want to start development"
1. ⚡ [../QUICKSTART.md](../QUICKSTART.md)
2. 📝 [../.env.example](../apps/web/.env.example)
3. 💡 [contributing/CHEAT_SHEET.md](contributing/CHEAT_SHEET.md)

### "I want to understand the codebase"
1. 📚 [../README.md](../README.md)
2. 🗂️ [TECHNICAL_SNAPSHOT.txt](TECHNICAL_SNAPSHOT.txt)
3. 🔍 Browse the code!

### "I want to contribute"
1. 🤝 [contributing/CONTRIBUTING.md](contributing/CONTRIBUTING.md)
2. 🔧 [setup/DEV_SETUP.md](setup/DEV_SETUP.md)
3. 🪝 [contributing/HUSKY_SETUP.md](contributing/HUSKY_SETUP.md)

### "I'm onboarding a new team member"
1. 👋 [../README.md](../README.md) - Overview
2. ⚡ [../QUICKSTART.md](../QUICKSTART.md) - Get started
3. 📖 [setup/DEV_SETUP.md](setup/DEV_SETUP.md) - Detailed setup
4. 🤝 [contributing/CONTRIBUTING.md](contributing/CONTRIBUTING.md) - How to work
5. 💡 [contributing/CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) - Quick reference

### "I'm planning the next milestone"
1. 🗺️ [PLAN_M4_STOREFRONT.txt](PLAN_M4_STOREFRONT.txt)
2. 🤖 [mcp/open-questions.md](mcp/open-questions.md)
3. 📁 [superpowers/plans/](superpowers/plans/)

### "I'm troubleshooting an issue"
1. 💡 [contributing/CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) - Common Issues section
2. 📖 [setup/DEV_SETUP.md](setup/DEV_SETUP.md) - Common Issues section
3. ⚡ [../QUICKSTART.md](../QUICKSTART.md) - Quick fixes

---

## 📁 Documentation by Location

### Root Directory
- README.md - Main project documentation
- QUICKSTART.md - 5-minute setup guide

### `/docs` Directory
- docs/TECHNICAL_SNAPSHOT.txt - Full architecture overview
- docs/ITERATIONS.txt - Build history
- docs/PLAN_M4_STOREFRONT.txt - Next milestone plan
- docs/setup/DEV_SETUP.md - Complete setup guide
- docs/setup/INSTALLATION.md - Environment setup
- docs/setup/DOCKER.md - Docker setup
- docs/contributing/CONTRIBUTING.md - Contribution guidelines
- docs/contributing/CHEAT_SHEET.md - Quick reference
- docs/contributing/HUSKY_SETUP.md - Pre-commit hooks
- docs/mcp/ - MCP server and agent-layer docs
- docs/superpowers/plans/ - Dated implementation plans
- docs/DOCS_INDEX.md - This file

### Configuration Files
- Makefile - Development commands
- .env.example - Environment config template
- .gitattributes - Git line ending config

### `/docker` Directory
- apps/web/docker/Dockerfile - Docker image configuration
- docker-compose.yml - Docker services (in root)

---

## 🔍 Finding Specific Information

### Database
- Setup: [DEV_SETUP.md](setup/DEV_SETUP.md) → Database Setup
- Commands: [CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) → Database Commands
- Schema & architecture: [TECHNICAL_SNAPSHOT.txt](TECHNICAL_SNAPSHOT.txt)
- Migrations: [Makefile](../Makefile) → make db-migrate

### Testing
- Setup: [DEV_SETUP.md](setup/DEV_SETUP.md) → Testing
- Commands: [CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) → Testing Patterns
- CI/CD: no CI workflow is configured in this repository

### Deployment
- Docker: [docker-compose.yml](../docker-compose.yml)
- Environment: [.env.example](../apps/web/.env.example)
- Deploys run from Railway, not a committed workflow — see [TECHNICAL_SNAPSHOT.txt](TECHNICAL_SNAPSHOT.txt)

### Code Quality
- Standards: [CONTRIBUTING.md](contributing/CONTRIBUTING.md) → Code Standards
- Linting: [CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) → Code Quality
- Pre-commit: [HUSKY_SETUP.md](contributing/HUSKY_SETUP.md)
- TypeScript: [tsconfig.json](../apps/web/tsconfig.json)

---

## 🤝 Improving Documentation

Found an issue? Want to add something?

1. Documentation is code - submit PRs!
2. Keep it simple and clear
3. Add examples where helpful
4. Test your instructions
5. Update this index when adding new docs
