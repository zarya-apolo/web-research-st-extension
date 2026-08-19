import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

const MODULE = 'webResearch';
const DEFAULTS = {
    enabled: false,
    tavilyApiKey: '',
    exaApiKey: '',
    tavilyUrl: 'https://api.tavily.com',
    exaUrl: 'https://api.exa.ai',
    defaultMode: 'auto',
    maxResults: 5,
    includeRawContent: false,
};
let toolsRegistered = false;

function settings() {
    extension_settings[MODULE] ??= { ...DEFAULTS };
    return extension_settings[MODULE];
}
function trimUrl(value) { return String(value || '').replace(/\/+$/, ''); }
function enabled() { return settings().enabled; }
function parseResponse(response, text) {
    try { return text ? JSON.parse(text) : {}; }
    catch { throw new Error(`${response.status}: provider returned non-JSON`); }
}
async function request(url, options, timeout = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        const data = parseResponse(response, text);
        if (!response.ok) throw new Error(`${response.status}: ${data?.detail || data?.message || text || response.statusText}`);
        return data;
    } finally { clearTimeout(timer); }
}
function normalize(provider, mode, query, data) {
    const raw = Array.isArray(data.results) ? data.results : (Array.isArray(data.citations) ? data.citations : []);
    const results = raw.map(item => ({
        title: item.title || '', url: item.url || item.id || '',
        excerpt: item.content || item.text || (Array.isArray(item.highlights) ? item.highlights.join('\n') : '') || item.summary || '',
        publishedDate: item.publishedDate || null, author: item.author || null,
    })).filter(item => item.url || item.excerpt);
    return { provider, mode, query, answer: data.answer || data.output?.content || null, results, images: data.images || [], requestId: data.requestId || data.request_id || null };
}
async function tavilySearch(query, mode = 'quick', options = {}) {
    const body = { query, search_depth: mode === 'deep' ? 'advanced' : 'basic', max_results: options.maxResults || settings().maxResults, include_answer: true, include_raw_content: Boolean(settings().includeRawContent) };
    return normalize('tavily', mode, query, await request(`${trimUrl(settings().tavilyUrl)}/search`, { method: 'POST', headers: { Authorization: `Bearer ${settings().tavilyApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}
async function exaSearch(query, mode = 'deep', options = {}) {
    const type = options.searchType || (mode === 'quick' ? 'fast' : 'deep');
    const body = { query, type, numResults: options.maxResults || settings().maxResults, contents: { highlights: true } };
    if (mode === 'deep') body.contents = { highlights: true, summary: true };
    return normalize('exa', mode, query, await request(`${trimUrl(settings().exaUrl)}/search`, { method: 'POST', headers: { 'x-api-key': settings().exaApiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, type.startsWith('deep') ? 120000 : 60000));
}
async function exaAnswer(query) {
    const data = await request(`${trimUrl(settings().exaUrl)}/answer`, { method: 'POST', headers: { 'x-api-key': settings().exaApiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, text: true }) }, 120000);
    return normalize('exa', 'answer', query, data);
}
function registerTools() {
    const context = getContext();
    if (!context.registerFunctionTool || !context.unregisterFunctionTool) return;
    ['web_research_quick', 'web_research_deep', 'web_research_answer', 'web_research_auto'].forEach(name => context.unregisterFunctionTool(name));
    if (!enabled()) { toolsRegistered = false; return; }
    const schema = { type: 'object', properties: { query: { type: 'string', description: 'Natural-language web research query.' } }, required: ['query'] };
    context.registerFunctionTool({ name: 'web_research_quick', displayName: 'Web Research: Quick (Tavily)', description: 'Fast, practical web search for wiki pages, synopses, current facts and straightforward lookups. Uses Tavily.', parameters: schema, formatMessage: a => `Quick web research: ${a?.query || ''}`, action: a => tavilySearch(a.query, 'quick') });
    context.registerFunctionTool({ name: 'web_research_deep', displayName: 'Web Research: Deep (Exa)', description: 'Semantic and multi-step research for lore, fandom questions, powers and limitations, comparisons and nuanced source discovery. Uses Exa.', parameters: schema, formatMessage: a => `Deep web research: ${a?.query || ''}`, action: a => exaSearch(a.query, 'deep') });
    context.registerFunctionTool({ name: 'web_research_answer', displayName: 'Web Research: Answer (Exa)', description: 'Ask one concrete question and receive an Exa-synthesized answer with citations.', parameters: schema, formatMessage: a => `Research answer: ${a?.query || ''}`, action: a => exaAnswer(a.query) });
    const autoSchema = { type: 'object', properties: { query: { type: 'string' }, mode: { type: 'string', enum: ['quick', 'deep', 'answer', 'auto'], description: 'quick=Tavily; deep/answer=Exa; auto selects by query complexity.' } }, required: ['query'] };
    context.registerFunctionTool({ name: 'web_research_auto', displayName: 'Web Research: Auto', description: 'Normalized web research router. Choose quick for a wiki/synopsis, deep for semantic fandom/lore research, or answer for a cited direct answer.', parameters: autoSchema, formatMessage: a => `Web research (${a?.mode || 'auto'}): ${a?.query || ''}`, action: a => { const mode = a.mode || settings().defaultMode; if (mode === 'quick') return tavilySearch(a.query, 'quick'); if (mode === 'answer') return exaAnswer(a.query); return exaSearch(a.query, 'deep'); } });
    toolsRegistered = true;
}
function save() { saveSettingsDebounced(); registerTools(); }
async function testProvider(provider) {
    const key = provider === 'tavily' ? settings().tavilyApiKey : settings().exaApiKey;
    const output = $(`#web_research_${provider}_status`);
    output.text('Testing...');
    try { const data = provider === 'tavily' ? await tavilySearch('Jujutsu Kaisen synopsis', 'quick', { maxResults: 1 }) : await exaSearch('Jujutsu Kaisen powers and limitations', 'deep', { maxResults: 1 }); output.text(`${provider} OK: ${data.results.length} result(s)`); } catch (error) { output.text(`${provider} failed: ${error.message}`); }
}
function bindSettings() {
    if ($('#web_research_settings').data('bound')) return;
    $('#web_research_settings').data('bound', true);
    $('#web_research_enabled').prop('checked', settings().enabled).on('change', function() { settings().enabled = this.checked; save(); });
    $('#web_research_tavily_key').val(settings().tavilyApiKey).on('input', function() { settings().tavilyApiKey = this.value; saveSettingsDebounced(); });
    $('#web_research_exa_key').val(settings().exaApiKey).on('input', function() { settings().exaApiKey = this.value; saveSettingsDebounced(); });
    $('#web_research_tavily_url').val(settings().tavilyUrl).on('input', function() { settings().tavilyUrl = this.value; saveSettingsDebounced(); });
    $('#web_research_exa_url').val(settings().exaUrl).on('input', function() { settings().exaUrl = this.value; saveSettingsDebounced(); });
    $('#web_research_default_mode').val(settings().defaultMode).on('change', function() { settings().defaultMode = this.value; saveSettingsDebounced(); });
    $('#web_research_max_results').val(settings().maxResults).on('change', function() { settings().maxResults = Math.max(1, Math.min(10, Number(this.value) || 5)); saveSettingsDebounced(); });
    $('#web_research_test_tavily').on('click', () => testProvider('tavily'));
    $('#web_research_test_exa').on('click', () => testProvider('exa'));
}
async function init() {
    extension_settings[MODULE] ??= { ...DEFAULTS };
    await $('#extensions_settings').append(await $.get('/scripts/extensions/third-party/web-research-st-extension/settings.html'));
    bindSettings(); registerTools();
}
eventSource.on(event_types.APP_READY, init);
