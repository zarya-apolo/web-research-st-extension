# Web Research for SillyTavern

A standalone SillyTavern extension exposing normalized web-research tools backed by Tavily and Exa.

## Tools

- `web_research_quick`: Tavily basic search for fast wiki, synopsis, current-fact and direct lookup queries.
- `web_research_deep`: Exa semantic/deep search for fandom, lore, powers, limitations, comparison and multi-source research.
- `web_research_answer`: Exa Answer for one concrete question with citations.
- `web_research_auto`: normalized router. `quick` uses Tavily; `deep` and `answer` use Exa.

Every tool returns the same normalized shape:

```json
{
  "provider": "tavily|exa",
  "mode": "quick|deep|answer",
  "query": "...",
  "answer": "...",
  "results": [{"title":"...","url":"...","excerpt":"...","publishedDate":null,"author":null}],
  "images": [],
  "requestId": "..."
}
```

## Configuration

Configure all values from the Web Research extension settings in SillyTavern:

- Tavily API URL and API key
- Exa API URL and API key
- Web Research relay URL (required for browser calls to Exa because Exa does not allow CORS)
- default mode
- maximum result count

The keys are local ST extension settings and are not included in this repository.
Both provider URLs and the optional relay URL are configurable.

## Optional VPN relay

`server.py` is a zero-dependency CORS relay intended to run on the user's own server. It binds to a configured VPN address and accepts only four fixed upstream routes: Exa Search, Exa Answer, Tavily Crawl and Tavily Research. It does not persist credentials. `web-research-relay.service` is a systemd unit template; update its bind address and installation path before enabling it.

When using the relay, configure its URL in ST. The extension sends the provider key per request using a relay-specific header, and the relay forwards it only to its fixed official provider endpoint.

Install from the public GitHub URL:

`https://github.com/zarya-apolo/web-research-st-extension`

## Provider semantics

Tavily is the quick path: basic/advanced search, answer, ranked page results and optional raw content.
Exa is the research path: fast/auto/deep search types, semantic retrieval, highlights, summaries, citations and Exa Answer.
