import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);

function definition(name: string) {
  const text = readFileSync(new URL(`.claude/agents/${name}.md`, root), 'utf8');
  const parts = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!parts) throw new Error(`Missing agent frontmatter: ${name}`);
  // These intentionally use plain scalar frontmatter, without a YAML dependency.
  const fields = Object.fromEntries(parts[1].split(/\r?\n/).map(line => {
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error(`Invalid frontmatter line in ${name}`);
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }));
  return { fields, body: parts[2] };
}

describe('repository Claude Code subagent routing', () => {
  it('pins repository exploration to Sonnet 5.5 at xhigh', () => {
    const { fields, body } = definition('repo-explorer');
    expect(fields.name).toBe('repo-explorer');
    expect(fields.model).toBe('claude-sonnet-5-5');
    expect(fields.effort).toBe('xhigh');
    expect(body).toContain('Do not implement changes');
  });

  it('pins deeper research to Opus 5.5 at xhigh', () => {
    const { fields, body } = definition('research');
    expect(fields.name).toBe('research');
    expect(fields.model).toBe('claude-opus-5-5');
    expect(fields.effort).toBe('xhigh');
    expect(body).toContain('evidence');
  });

  it('pins delegated QA and code review to Sonnet 5.5 at xhigh', () => {
    const { fields, body } = definition('qa');
    expect(fields.name).toBe('qa');
    expect(fields.model).toBe('claude-sonnet-5-5');
    expect(fields.effort).toBe('xhigh');
    expect(fields.description).toContain('code review');
    expect(body).toContain('Leave implementation fixes and test-code changes');
  });

  it('does not override the main model or effort for implementation and other work', () => {
    const { fields, body } = definition('implementation');
    expect(fields.model).toBe('inherit');
    expect(fields).not.toHaveProperty('effort');
    expect(body).toContain("main session's model and effort");
    expect(fields.description).toContain('test-code changes');
    expect(fields.description).toContain('planning');
  });

  it('supplies named agents and a routing rule instead of assuming builtin Explore is overridden', () => {
    const guidance = readFileSync(new URL('CLAUDE.md', root), 'utf8');
    for (const name of ['repo-explorer', 'research', 'qa', 'implementation']) {
      expect(guidance).toContain(`.claude/agents/${name}.md`);
    }
    expect(guidance).toContain('instead of the built-in `Explore`');
    expect(guidance).toContain('omit per-call model/effort overrides');
    expect(guidance).toContain('Explicit user overrides take precedence');
  });

  it('keeps native forks in the inherited-model bucket', () => {
    const guidance = readFileSync(new URL('CLAUDE.md', root), 'utf8');
    expect(guidance).toContain('A native `fork` always inherits');
    expect(guidance).toContain('not exploration, research or QA/review');
    expect(guidance).toContain('does not require an extra QA agent or approval gate');
  });
});
