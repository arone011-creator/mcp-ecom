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
2. [project/PROJECT_STRUCTURE.md](project/PROJECT_STRUCTURE.md) - Code organization
3. [project/ROADMAP.md](project/ROADMAP.md) - Future plans

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
| [project/PROJECT_STRUCTURE.md](project/PROJECT_STRUCTURE.md) | Code organization and architecture | Developers |
| [project/ROADMAP.md](project/ROADMAP.md) | Future features and long-term plans | Everyone |
| [project/REVAMP_SUMMARY.md](project/REVAMP_SUMMARY.md) | Summary of 2025 improvements | Stakeholders |
| [project/MODERNIZATION_2025.md](project/MODERNIZATION_2025.md) | Technical quality and standards report | Developers |
| [project/IMAGE_FIX_SUMMARY.md](project/IMAGE_FIX_SUMMARY.md) | Product image implementation details | Developers |
| [project/ROBUSTNESS_FIXES.md](project/ROBUSTNESS_FIXES.md) | Client/server component fixes | Developers |
| [project/REORGANIZATION.md](project/REORGANIZATION.md) | Repository organization history | Maintainers |

### Configuration

| File | Purpose | Audience |
|------|---------|----------|
| [.env.example](../apps/web/.env.example) | Environment variables template | Developers |
| [Makefile](../Makefile) | Development automation commands | Developers |
| [docker-compose.yml](../docker-compose.yml) | Docker services configuration | DevOps |

### Additional Documentation

| File | Purpose | Audience |
|------|---------|----------|
| [setup/QUICK_START_2025.md](setup/QUICK_START_2025.md) | 2025 standards quick reference | Developers |
| [project/UPGRADE_SUMMARY.md](project/UPGRADE_SUMMARY.md) | Past upgrade history | Maintainers |
| [project/TEST_RESULTS.md](project/TEST_RESULTS.md) | Test suite results | QA/Developers |

---

## 🎯 By Use Case

### "I just want to start development"
1. ⚡ [../QUICKSTART.md](../QUICKSTART.md)
2. 📝 [../.env.example](../apps/web/.env.example)
3. 💡 [contributing/CHEAT_SHEET.md](contributing/CHEAT_SHEET.md)

### "I want to understand the codebase"
1. 📚 [../README.md](../README.md)
2. 🗂️ [project/PROJECT_STRUCTURE.md](project/PROJECT_STRUCTURE.md)
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

### "I'm planning the project roadmap"
1. 🗺️ [project/ROADMAP.md](project/ROADMAP.md)
2. 📊 [project/MODERNIZATION_2025.md](project/MODERNIZATION_2025.md)
3. 📝 [project/REVAMP_SUMMARY.md](project/REVAMP_SUMMARY.md)

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
- docs/setup/DEV_SETUP.md - Complete setup guide
- docs/contributing/CONTRIBUTING.md - Contribution guidelines
- docs/contributing/CHEAT_SHEET.md - Quick reference
- docs/contributing/HUSKY_SETUP.md - Pre-commit hooks
- docs/project/ROADMAP.md - Future plans
- docs/project/REVAMP_SUMMARY.md - 2025 improvements
- docs/project/PROJECT_STRUCTURE.md - Code organization
- docs/project/MODERNIZATION_2025.md - Quality report
- docs/project/UPGRADE_SUMMARY.md - Upgrade history
- docs/project/TEST_RESULTS.md - Test results
- docs/DOCS_INDEX.md - This file

### Configuration Files
- Makefile - Development commands
- .env.example - Environment config template
- .gitattributes - Git line ending config

### `/docker` Directory
- apps/web/docker/Dockerfile - Docker image configuration
- docker-compose.yml - Docker services (in root)

### `/docs` Directory
- docs/analysis/ANALYSIS.md - Project analysis
- docs/analysis/START_HERE.md - Getting started guide
- docs/analysis/REMAINING_FIXES.md - Known issues
- docs/analysis/COMPLETION_REPORT.md - Milestone report
- docs/analysis/PROJECT_HEALTH_REPORT.md - Health metrics

---

## 🔍 Finding Specific Information

### Database
- Setup: [DEV_SETUP.md](setup/DEV_SETUP.md) → Database Setup
- Commands: [CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) → Database Commands
- Schema: [PROJECT_STRUCTURE.md](project/PROJECT_STRUCTURE.md)
- Migrations: [Makefile](../Makefile) → make db-migrate

### Testing
- Setup: [DEV_SETUP.md](setup/DEV_SETUP.md) → Testing
- Commands: [CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) → Testing Patterns
- Results: [TEST_RESULTS.md](project/TEST_RESULTS.md)
- CI/CD: no CI workflow is configured in this repository

### Deployment
- Docker: [docker-compose.yml](../docker-compose.yml)
- Vercel: [README.md](README.md) → Deployment
- Environment: [.env.example](../apps/web/.env.example)
- CI/CD: deploys run from Railway, not a committed workflow

### Code Quality
- Standards: [CONTRIBUTING.md](contributing/CONTRIBUTING.md) → Code Standards
- Linting: [CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) → Code Quality
- Pre-commit: [HUSKY_SETUP.md](contributing/HUSKY_SETUP.md)
- TypeScript: [tsconfig.json](../apps/web/tsconfig.json)

---

## 🆕 What's New (March 2025)

### New Documentation Created
✨ [QUICKSTART.md](../QUICKSTART.md) - 5-minute setup  
✨ [DEV_SETUP.md](setup/DEV_SETUP.md) - Complete guide  
✨ [CONTRIBUTING.md](contributing/CONTRIBUTING.md) - How to contribute  
✨ [CHEAT_SHEET.md](contributing/CHEAT_SHEET.md) - Quick reference  
✨ [HUSKY_SETUP.md](contributing/HUSKY_SETUP.md) - Pre-commit hooks  
✨ [ROADMAP.md](project/ROADMAP.md) - Future plans  
✨ [REVAMP_SUMMARY.md](project/REVAMP_SUMMARY.md) - Improvements summary  
✨ [Makefile](../Makefile) - Automation commands  
✨ [.gitattributes](../.gitattributes) - Git configuration  

### Enhanced Documentation
📝 [.env.example](../apps/web/.env.example) - Now with detailed comments  
📝 [.gitignore](../.gitignore) - Updated for venv and test artifacts  
📝 [README.md](README.md) - Added documentation section  

---

## 💡 Tips for Using This Documentation

1. **Bookmark this index** for quick navigation
2. **Start with QUICKSTART.md** if you're new
3. **Use CHEAT_SHEET.md** as your daily reference
4. **Refer to DEV_SETUP.md** when stuck
5. **Read CONTRIBUTING.md** before your first PR

---

## 🤝 Improving Documentation

Found an issue? Want to add something?

1. Documentation is code - submit PRs!
2. Keep it simple and clear
3. Add examples where helpful
4. Test your instructions
5. Update this index when adding new docs

---

## 📊 Documentation Stats

- **Total Documentation Files**: 11 core + 5 additional
- **Total Lines**: ~3,000+ lines of helpful content
- **Languages**: Markdown, Shell, Docker, TypeScript configs
- **Last Updated**: March 2025

---

**Questions about the docs? Open an issue!**

Last updated: March 2025
