// Repo-only Meshy MCP configuration (2026-10-29, docs/meshy-mcp.md): the project MCP entry for Meshy stays pinned and
// key-free. docs/meshy.mcp.json is the template; the root .mcp.json (Claude Code's project file) is checked too once it
// exists. The expansion check uses a dummy NON-secret value only; no real environment is read or printed.
import {describe, expect, it} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const repo = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const configs = ['docs/meshy.mcp.json', '.mcp.json'].filter(f => existsSync(repo(f)));

interface McpServer { command: string; args: string[]; env?: Record<string, string> }

/** Claude Code's `.mcp.json` string expansion (`${VAR}` / `${VAR:-default}`; a missing variable stays unexpanded and is reported). */
function expand(s: string, env: Record<string, string | undefined>): {value: string; missing: string[]} {
  const missing: string[] = [];
  const value = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name: string, def?: string) => {
    const v = env[name];
    if (v !== undefined) return v;
    if (def !== undefined) return def;
    missing.push(name);
    return whole;
  });
  return {value, missing};
}

describe('Meshy MCP project configuration', () => {
  it('the template exists (and .mcp.json, when present, carries the same meshy entry)', () => {
    expect(configs).toContain('docs/meshy.mcp.json');
    const tpl = JSON.parse(readFileSync(repo('docs/meshy.mcp.json'), 'utf8'));
    if (existsSync(repo('.mcp.json'))) expect(JSON.parse(readFileSync(repo('.mcp.json'), 'utf8')).mcpServers.meshy).toEqual(tpl.mcpServers.meshy);
  });

  for (const f of configs) {
    it(`${f}: official package pinned, stdio via npx, key only from the environment (no literal key, no default)`, () => {
      const text = readFileSync(repo(f), 'utf8');
      const meshy = (JSON.parse(text) as {mcpServers: Record<string, McpServer>}).mcpServers.meshy;
      expect(meshy.command).toBe('npx');
      expect(meshy.args).toEqual(['-y', '@meshy-ai/meshy-mcp-server@0.6.6']);
      expect(meshy.env).toEqual({MESHY_API_KEY: '${MESHY_API_KEY}'});
      expect(text).not.toMatch(/msy_/i); // no Meshy key (or the README placeholder) committed
      expect(text).not.toMatch(/:-/); // no fallback value
    });
  }

  it('expansion: a dummy non-secret value resolves; without the variable it stays unexpanded and is reported missing', () => {
    const tpl = JSON.parse(readFileSync(repo('docs/meshy.mcp.json'), 'utf8')) as {mcpServers: {meshy: McpServer}};
    const ref = tpl.mcpServers.meshy.env!.MESHY_API_KEY;
    expect(expand(ref, {MESHY_API_KEY: 'dummy-not-a-key'})).toEqual({value: 'dummy-not-a-key', missing: []});
    expect(expand(ref, {})).toEqual({value: '${MESHY_API_KEY}', missing: ['MESHY_API_KEY']});
  });

  it('local secret files stay git-ignored (.env / .env.*; .env.example allowed)', () => {
    const gi = readFileSync(repo('.gitignore'), 'utf8').split('\n').map(l => l.trim());
    expect(gi).toEqual(expect.arrayContaining(['.env', '.env.*', '!.env.example']));
  });
});
