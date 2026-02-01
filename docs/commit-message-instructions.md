# Conventional Commit Message Guidelines

Follow this format for all commit messages:

```
type(scope): subject
```

**type** (required):
- `feat` 
- `fix` 
- `refactor` 
- `perf` 
- `docs` 
- `test` 
- `build` 
- `ci` 
- `chore` 
- `style` 
- `revert` 

**scope** (optional), e.g.:
- `api`, `ui`, `auth`, `scheduler`, `queue`, etc.

**subject** (required):
- Use the imperative mood: "Add feature" **NOT** "Added feature" or "Adds feature"
- Be concise and clear

**References:**
- To reference issues/PRs, add at the end: `Refs: #123` or `Closes: #123`

**UI changes:**
- Clearly describe the UI change, e.g. `Update button styles in settings page`
