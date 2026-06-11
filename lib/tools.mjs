// The agent's sensory spine. Backstop's senses are core Splunk REST + SPL, exposed as a
// small set of named tools. When the OFFICIAL Splunk MCP Server (app 7931, /services/mcp)
// is installed, splunk.search / splunk.list_sourcetypes route through it (real MCP). When
// it isn't (the trial default), the identical searches run over the 443 REST proxy —
// same senses, different transport. The transport in force is reported so the UI never
// hides which mode it's in. This is a genuine "AI-agent-tools-for-Splunk" layer either way.

export class SplunkTools {
  constructor(client) {
    this.sp = client;
    this.transport = 'rest-proxy'; // resolved on init()
    this.mcpAvailable = false;
  }

  async init() {
    this.mcpAvailable = await this.sp.mcpAvailable();
    this.transport = this.mcpAvailable ? 'mcp-server' : 'rest-proxy';
    return this;
  }

  // tool: splunk.list_saved_searches — enumerate the detection estate
  async list_saved_searches() {
    return this.sp.savedSearches();
  }

  // tool: splunk.search — run SPL. Routed through MCP when available, else REST proxy.
  async search(spl, opts) {
    if (this.mcpAvailable) {
      try {
        const r = await this.sp.mcp('/tools/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'splunk.search', arguments: { query: spl, ...(opts || {}) } }),
        });
        if (r && r.status < 400) {
          const j = await r.json();
          // MCP tool result shapes vary; accept the common ones, else fall through.
          const rows = j.results || j.content?.results || j.rows;
          if (Array.isArray(rows)) return rows;
        }
      } catch {
        // fall through to REST proxy — same search, different transport
      }
    }
    return this.sp.search(spl, opts);
  }

  // tool: splunk.freshness_sweep — one pass for the real last-seen of every data source
  async freshness_sweep({ earliest = '-30d', latest = 'now' } = {}) {
    const tstats = await this.search('| tstats latest(_time) as last by index, sourcetype', {
      earliest,
      latest,
    });
    let metadata = [];
    try {
      metadata = await this.search('| metadata type=sourcetypes index=*', { earliest, latest });
    } catch {
      metadata = [];
    }
    return { tstats, metadata };
  }
}
