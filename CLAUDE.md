# gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

## Available skills

- `/office-hours` - YC Office Hours
- `/plan-ceo-review` - CEO/founder plan review
- `/plan-eng-review` - Eng manager plan review
- `/plan-design-review` - Designer plan review
- `/plan-devex-review` - DevEx plan review
- `/design-consultation` - Design consultation
- `/design-shotgun` - Design shotgun
- `/design-html` - Design HTML
- `/review` - Pre-landing PR review
- `/ship` - Ship workflow
- `/land-and-deploy` - Land and deploy
- `/canary` - Post-deploy canary monitoring
- `/benchmark` - Performance regression detection
- `/browse` - Headless browser for QA and browsing
- `/connect-chrome` - Connect to Chrome
- `/qa` - QA test and fix bugs
- `/qa-only` - Report-only QA testing
- `/design-review` - Designer's eye QA
- `/setup-browser-cookies` - Import browser cookies
- `/setup-deploy` - Configure deployment settings
- `/retro` - Weekly engineering retrospective
- `/investigate` - Systematic debugging
- `/document-release` - Post-ship documentation update
- `/codex` - OpenAI Codex CLI wrapper
- `/cso` - Chief Security Officer mode
- `/autoplan` - Auto-review pipeline
- `/devex-review` - DevEx review
- `/careful` - Safety guardrails
- `/freeze` - Restrict edits to a directory
- `/guard` - Full safety mode
- `/unfreeze` - Clear freeze boundary
- `/gstack-upgrade` - Upgrade gstack
- `/learn` - Self-learning

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
