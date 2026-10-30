"""Startup checks for Account Domino Mapper (Playwright for Python; not part of CI).

The first view without saved preferences, and a readable page while JavaScript is held back,
missing or disabled. The repository is served on an ephemeral loopback port while the checks run.
    python test/startup.browser.py
    python test/startup.browser.py --output <folder>
Results and screenshots are written to --output (default: a new folder in the system temporary
directory). Nothing is written inside the repository.
"""
import argparse
import base64
import hashlib
import json
import sys
import tempfile
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "account-domino-mapper."
SOURCES = ("index.html", "style.css", "theme-init.js", "domino-core.js", "domino-data.js", "domino-view.js", "messages.js",
           "app.js", "test/startup.browser.py")
SCRIPTS = ["theme-init.js", "domino-core.js", "domino-data.js", "domino-view.js", "messages.js", "app.js"]
TABS_JA = ["連鎖を追う", "閉め出し", "1手で比べる", "規則表"]
# The places where a static Japanese tab name may break (between its words)
TAB_SPLITS = {"連鎖を追う": (("連鎖を追う",), ("連鎖を", "追う")), "閉め出し": (("閉め出し",),),
              "1手で比べる": (("1手で比べる",), ("1手で", "比べる")), "規則表": (("規則表",),)}
# Each tab: the lines its text shows (characters grouped by their line)
TAB_LINES = """() => Array.from(document.querySelectorAll('[role="tab"]'), tab => {
  const chars = [];
  const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    for (let i = 0; i < node.length; i++) {
      const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
      const rect = range.getClientRects()[0];
      if (rect && rect.width > 0) chars.push([node.data[i], rect.top]);
    }
  }
  const lines = []; let top = null;
  for (const [ch, t] of chars) { if (top === null || Math.abs(t - top) > 3) { lines.push(''); top = t; } lines[lines.length - 1] += ch; }
  return lines.map(s => s.trim());
})"""
# name, browser, width, language (query), locale, theme, and what the case does
CASES = (
    dict(name="first-view-ja-chromium", browser="chromium", width=320, language="ja", theme="light", hold_app=True),
    dict(name="first-view-en-firefox", browser="firefox", width=1280, language="en", theme="dark", hold_app=True),
    dict(name="css-then-app-chromium", browser="chromium", width=320, language="en", theme="dark", hold_css=True, hold_app=True),
    dict(name="css-then-app-firefox", browser="firefox", width=1280, language="ja", theme="light", hold_css=True, hold_app=True),
    dict(name="missing-core", browser="chromium", width=320, language="ja", theme="light", fail="domino-core.js", missing="DominoCore"),
    dict(name="missing-data", browser="firefox", width=1280, language="en", theme="dark", fail="domino-data.js", missing="DominoData"),
    dict(name="missing-view", browser="chromium", width=1280, language="en", theme="light", fail="domino-view.js", missing="DominoView"),
    dict(name="missing-messages", browser="firefox", width=320, language="ja", theme="dark", fail="messages.js",
         missing="DominoMessages"),
    dict(name="missing-app", browser="chromium", width=390, language="ja", theme="light", fail="app.js"),
    dict(name="javascript-disabled-ja", browser="chromium", width=320, language="ja", theme="light", disabled=True),
    dict(name="javascript-disabled-en", browser="firefox", width=320, language="en", theme="dark", disabled=True),
    dict(name="storage-denied", browser="chromium", width=320, language="en", locale="ja", theme="dark", storage_denied=True),
    dict(name="query-over-saved", browser="firefox", width=1280, language="ja", locale="en", theme="dark",
         saved={"language": "en", "theme": "light"}, hold_app=True),
    dict(name="preference-separation-chromium", browser="chromium", width=320, language="ja", theme="dark", separate=True),
    dict(name="preference-separation-firefox", browser="firefox", width=1280, language="en", theme="light", separate=True),
)
# Records every state of the page while it starts, so that readiness can be checked against the content that was there.
PROBE = """(() => {
  window.__startup = {states: [], csp: []};
  document.addEventListener('securitypolicyviolation', e => window.__startup.csp.push(e.violatedDirective));
  let previous = '';
  const sample = () => {
    const ready = document.documentElement.dataset.appReady;
    const state = {ready, rows: document.querySelectorAll('#chain-map tbody tr').length,
      summary: !!(document.querySelector('#step-summary') || {}).textContent,
      detail: !!(document.querySelector('#detail-heading') || {}).textContent,
      note: !!document.querySelector('#startup-note'),
      tools: (document.querySelector('#startup-tools') || {}).disabled,
      controls: (document.querySelector('#startup-controls') || {}).disabled};
    const key = JSON.stringify(state);
    if (key !== previous) { window.__startup.states.push(state); previous = key; }
  };
  new MutationObserver(sample).observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
})();"""
SNAPSHOT = """() => {
  const note = document.querySelector('#startup-note');
  const text = selector => (document.querySelector(selector) || {}).textContent || '';
  return {readyState: document.readyState, ready: document.documentElement.dataset.appReady,
    lang: document.documentElement.lang, theme: document.documentElement.dataset.theme || null,
    h1: text('h1'), intro: text('.intro'), chainIntro: text('#panel-chain [data-i18n="chainIntro"]'),
    tabs: Array.from(document.querySelectorAll('[role="tab"]'), tab => tab.textContent.trim()),
    personHeading: text('#person-heading'), persons: Array.from(document.querySelectorAll('.person-buttons button'), b => b.textContent),
    counts: text('#person-counts'),
    note: note ? note.innerText : '', noteVisible: !!note && note.getClientRects().length > 0,
    toolsDisabled: (document.querySelector('#startup-tools') || {}).disabled,
    controlsDisabled: (document.querySelector('#startup-controls') || {}).disabled,
    // every control of the two guarded groups (a disabled fieldset does not stop a summary from opening its details box)
    allDisabled: Array.from(document.querySelectorAll(['#startup-tools', '#startup-controls']
      .map(group => ['button', 'summary', 'a[href]', 'select', 'input'].map(tag => group + ' ' + tag).join(', ')).join(', ')))
      .every(control => control.matches(':disabled') || !control.getClientRects().length),
    fourCards: (box => box ? {shown: box.getClientRects().length > 0, open: box.open} : null)(document.querySelector('#four-cards')),
    unnamed: Array.from(document.querySelectorAll('button')).filter(b => b.getClientRects().length && !b.textContent.trim()
      && !b.getAttribute('aria-label')).map(b => b.id),
    rows: document.querySelectorAll('#chain-map tbody tr').length,
    summary: text('#step-summary'), detail: text('#detail-heading'), detailBody: text('#detail-body'),
    startHere: !!document.querySelector('#start-here') && document.querySelector('#start-here').getClientRects().length > 0,
    caption: text('#chain-map caption'),
    focus: document.activeElement === document.body ? 'BODY' : (document.activeElement.id || document.activeElement.tagName),
    client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    evidence: window.__startup || {states: [], csp: []}};
}"""
PREFERENCE_SPY = """(() => {
  window.__writes = [];
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === window.localStorage) window.__writes.push([String(key), String(value)]);
    return original.call(this, key, value);
  };
})();"""
# In print media: what is printed when the application is not there (the printed sheets are then empty). The colors of every
# text that is printed (each text node that is rendered), and the pressed buttons (the person and the card chosen) with their
# text color and their background
PRINTED = """() => {
  const shown = el => !!el && el.getClientRects().length > 0;
  const color = sel => getComputedStyle(document.querySelector(sel)).color;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const texts = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.data.trim() && shown(node.parentElement)) texts.push(getComputedStyle(node.parentElement).color);
  }
  return {heading: shown(document.querySelector('h1')), intro: shown(document.querySelector('.intro')),
    chain: shown(document.querySelector('#panel-chain')), sheet: document.querySelector('#print-sheet').children.length,
    colors: ['h1 span', '.intro', '#person-heading', '#person-counts', '#person-worker', '#panel-chain h2'].map(color),
    textNodes: texts.length, textColors: Array.from(new Set(texts)),
    pressed: ['#person-worker', '#card-leak'].map(sel => (el => [sel, el.getAttribute('aria-pressed'),
      getComputedStyle(el).color, getComputedStyle(el).backgroundColor])(document.querySelector(sel)))};
}"""
PREFERENCES = """() => ({theme: document.documentElement.dataset.theme, language: document.documentElement.lang,
  savedTheme: localStorage.getItem('account-domino-mapper.theme'), savedLanguage: localStorage.getItem('account-domino-mapper.language'),
  writes: window.__writes})"""


def check(condition, message):
    if not condition:
        raise AssertionError(message)


SUMMARY_FOCUS = """() => { const summary = document.querySelector('#four-cards > summary'); summary.focus();
  const took = document.activeElement === summary; if (took) summary.blur(); return took; }"""


def pending_contract(page, snap, language, width):
    """Before the application is ready: static Japanese text and the startup notice are readable; every control is disabled,
    and the four-cards box (it has nothing to show yet) can be neither seen, focused nor opened. On a narrow screen a static
    tab name breaks only between its words (a <wbr> in the page; Firefox has no word-break: auto-phrase)."""
    check(snap["ready"] != "true", "an unfinished application must not signal readiness")
    if width <= 390:
        lines = page.evaluate(TAB_LINES)
        check(len(lines) == len(TABS_JA) and all(tuple(tab) in TAB_SPLITS[name] for tab, name in zip(lines, TABS_JA)),
              ("a static tab name breaks between words", lines))
    check(snap["toolsDisabled"] and snap["controlsDisabled"] and snap["allDisabled"], "controls stay disabled until ready")
    check(snap["fourCards"] == {"shown": False, "open": False}, ("the four-cards box before ready", snap["fourCards"]))
    check(not page.evaluate(SUMMARY_FOCUS), "the four-cards summary cannot take the focus before ready")
    # Pressing Tab through the page never reaches the summary of the four-cards box
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    reached = []
    for _ in range(12):
        page.keyboard.press("Tab")
        reached.append(page.evaluate("() => document.activeElement === document.querySelector('#four-cards > summary')"))
    check(not any(reached) and page.evaluate("() => !document.querySelector('#four-cards').open"), ("Tab before ready", reached))
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    check(snap["noteVisible"] and "準備中" in snap["note"] and "Loading" in snap["note"], ("bilingual startup notice", snap["note"]))
    check(snap["h1"] == "Account Domino Mapper", "static heading")
    check(snap["tabs"] == TABS_JA, ("static Japanese tabs", snap["tabs"]))
    check(snap["personHeading"] == "人物（架空）" and len(snap["persons"]) == 3, "static person band")
    check("架空の3人" in snap["intro"] and "倒れる" in snap["chainIntro"], "static Japanese text is readable")
    check(not snap["unnamed"], ("unnamed buttons", snap["unnamed"]))
    page.locator("#startup-help > summary").click()
    help_text = page.locator("#startup-help").inner_text()
    check("JavaScript" in help_text and "開き直" in help_text, "the startup help explains what to do")
    check(page.locator("#startup-reload").is_visible(), "the reload link is visible")
    check(page.locator("#startup-reload").evaluate("el => el.href === location.href"), "the reload link keeps the URL")
    check(page.locator("#startup-reload").get_attribute("target") == "_blank", "the reload link opens a new tab")
    check(page.locator("#startup-reload").get_attribute("rel") == "noopener noreferrer", "the reload link has no opener")
    page.locator("#startup-help > summary").click()


def ready_contract(page, snap, spec):
    """The first view: heading, person band, the map table of tab 1, the step summary and the detail are filled in."""
    check(snap["ready"] == "true", "ready")
    check(not snap["toolsDisabled"] and not snap["controlsDisabled"], "the startup guards are released")
    check(not snap["noteVisible"] and not snap["note"], "the startup notice is removed")
    check(snap["rows"] == 9 and snap["caption"], ("the map table of the office worker", snap["rows"]))
    check(snap["summary"] and snap["detail"] and snap["detailBody"], "the summary and the detail are filled in")
    check(snap["startHere"], "the start-here line is shown")
    check(snap["scroll"] <= snap["client"], "no horizontal page scroll")
    ready_states = [state for state in snap["evidence"]["states"] if state["ready"] == "true"]
    check(ready_states and all(state["rows"] == 9 and state["summary"] and state["detail"] and not state["note"]
                               and not state["tools"] and not state["controls"] for state in ready_states),
          ("readiness never comes before the complete first view", ready_states[:3]))
    check(not page.evaluate("() => !!document.activeElement.closest('[hidden]')"), "the focus is never left in a hidden element")
    # When ready, the four-cards box is shown and opens on the table of the office worker (nine rows)
    check(snap["fourCards"] == {"shown": True, "open": False}, ("the four-cards box when ready", snap["fourCards"]))
    page.locator("#four-cards > summary").click()
    check(page.locator("#four-cards").evaluate("el => el.open") and page.locator("#four-cards-table tbody tr").count() == 9,
          "the four-cards box opens when ready")
    page.locator("#four-cards > summary").click()


def preference_separation(page, spec):
    language = spec["language"]
    other_language = "en" if language == "ja" else "ja"
    theme = spec["theme"]
    other_theme = "light" if theme == "dark" else "dark"
    states = []

    def sample(stage):
        value = page.evaluate(PREFERENCES)
        value["stage"] = stage
        states.append(value)
        return value

    initial = sample("initial")
    check(initial["writes"] == [] and initial["savedTheme"] is None and initial["savedLanguage"] is None,
          "the first view does not save an implicit preference")
    page.locator("#language").click()
    changed = sample("language")
    check(changed["language"] == other_language and changed["savedLanguage"] == other_language, "the language button saves its choice")
    check(changed["theme"] == theme and changed["savedTheme"] is None, "the language button does not pin the theme")
    check(changed["writes"] == [[PREFIX + "language", other_language]], "the language button writes the language key only")
    page.emulate_media(color_scheme=other_theme)
    page.reload(wait_until="load")
    page.wait_for_function("() => document.documentElement.dataset.appReady === 'true'")
    reloaded = sample("reload")
    check(reloaded["theme"] == other_theme and reloaded["savedTheme"] is None, "an unsaved theme follows the system after reload")
    check(reloaded["language"] == language and reloaded["savedLanguage"] == other_language, "the query keeps priority")
    check(reloaded["writes"] == [], "a reload writes nothing")
    page.locator("#theme").click()
    changed = sample("theme")
    check(changed["theme"] == theme and changed["savedTheme"] == theme, "the theme button saves its choice")
    check(changed["writes"] == [[PREFIX + "theme", theme]], "the theme button writes the theme key only")
    return states


def screenshot(page, cdp, path):
    if cdp:
        captured = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        path.write_bytes(base64.b64decode(captured["data"]))
    else:
        page.screenshot(path=str(path), full_page=False, timeout=10000)


def run_case(playwright, url, spec, output):
    browser = getattr(playwright, spec["browser"]).launch(headless=True)
    language = spec["language"]
    context = browser.new_context(viewport={"width": spec["width"], "height": 900},
                                  locale=spec.get("locale", language), color_scheme=spec["theme"],
                                  java_script_enabled=not spec.get("disabled", False), reduced_motion="reduce")
    page = context.new_page()
    errors, failures, console = [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda request: failures.append(request.url))
    page.on("console", lambda message: console.append(message.text) if message.type == "error" else None)
    page.add_init_script(PROBE)
    if spec.get("separate"):
        page.add_init_script(PREFERENCE_SPY)
    if spec.get("storage_denied"):
        page.add_init_script("""Storage.prototype.getItem = function () { throw new DOMException('blocked for the test', 'SecurityError'); };
          Storage.prototype.setItem = function () { throw new DOMException('blocked for the test', 'SecurityError'); };""")
    if spec.get("saved"):
        page.add_init_script("for (const [key, value] of Object.entries(" + json.dumps(spec["saved"]) + "))"
                             " localStorage.setItem('" + PREFIX + "' + key, value);")
    held = {"app": [], "css": []}
    if spec.get("hold_app"):
        page.route("**/app.js", lambda route: held["app"].append(route))
    if spec.get("hold_css"):
        page.route("**/style.css", lambda route: held["css"].append(route))
    if spec.get("fail"):
        page.route("**/" + spec["fail"], lambda route: route.abort("failed"))
    cdp = context.new_cdp_session(page) if spec["browser"] == "chromium" else None
    result = {"case": spec["name"], "spec": spec, "browser_version": browser.version, "snapshots": []}

    def snap(stage, picture=True):
        value = page.evaluate(SNAPSHOT)
        value["stage"] = stage
        result["snapshots"].append(value)
        if picture:
            screenshot(page, cdp, output / (spec["name"] + "-" + stage + ".png"))
        return value

    try:
        page.goto(url + "?lang=" + language, wait_until="commit")
        if spec.get("hold_css"):
            # Wait for the request of style.css to reach the route that holds it (polled every 50 ms, at most 5 s)
            for _ in range(100):
                if held["css"]:
                    break
                page.wait_for_timeout(50)
            check(held["css"], "style.css is held")
            snap("css-pending", picture=False)
            release(held["css"])
            page.wait_for_function("() => document.styleSheets.length > 0")
        page.wait_for_function("() => !!document.querySelector('#panel-rules')")
        if spec.get("hold_app"):
            # Wait for the request of app.js to reach the route that holds it (polled every 50 ms, at most 5 s)
            for _ in range(100):
                if held["app"]:
                    break
                page.wait_for_timeout(50)
            check(held["app"], "app.js is held")
            page.wait_for_function("() => document.readyState !== 'loading'")
            pending = snap("app-pending", picture=spec["browser"] == "chromium")
            pending_contract(page, pending, language, spec["width"])
            check(pending["theme"] == spec.get("saved", {}).get("theme", spec["theme"]), "the theme is decided before the application")
            release(held["app"])
        page.wait_for_load_state("load")
        if spec.get("fail") or spec.get("disabled"):
            # A missing or disabled script leaves no signal to wait for: the scripts have run by the load event, and
            # 300 ms more lets an error that comes late (from a timer) reach the checks below
            page.wait_for_timeout(300)
            unavailable = snap("unavailable")
            pending_contract(page, unavailable, language, spec["width"])
            # Printing without the application shows the page's own text, black on white even when the theme is dark (the
            # printed sheets stay empty; hiding everything else would print a blank page)
            page.emulate_media(media="print")
            printed = page.evaluate(PRINTED)
            page.emulate_media(media="null")
            check(printed["heading"] and printed["intro"] and printed["chain"] and printed["sheet"] == 0,
                  ("print without the application shows the page's text", printed))
            check(set(printed["colors"]) == {"rgb(0, 0, 0)"}, ("print without the application is black", printed["colors"]))
            # Every printed text, not only the named ones (the page's own text is printed: dozens of text nodes)
            check(printed["textNodes"] >= 20 and printed["textColors"] == ["rgb(0, 0, 0)"],
                  ("every printed text is black without the application", printed["textNodes"], printed["textColors"]))
            # A pressed button prints black on white as well, so that its name stays readable when backgrounds are printed
            check(all(pressed == "true" and text == "rgb(0, 0, 0)" and back == "rgb(255, 255, 255)"
                      for _, pressed, text, back in printed["pressed"]), ("a pressed button prints black on white", printed["pressed"]))
            result["printed"] = printed
            if spec.get("disabled"):
                check(page.locator("noscript").count() == 1, "the noscript message")
                page.locator("#startup-help > summary").click()
                original = page.url
                with context.expect_page() as opened:
                    page.locator("#startup-reload").click()
                reopened = opened.value
                reopened.wait_for_load_state("load")
                check(reopened.url == original and page.url == original, "reopening keeps the URL in both tabs")
                check(reopened.evaluate("() => window.opener === null"), "the reopened tab has no opener")
                pending_contract(reopened, reopened.evaluate(SNAPSHOT), language, spec["width"])
                reopened.close()
        else:
            page.wait_for_function("() => document.documentElement.dataset.appReady === 'true'")
            page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            ready = snap("ready")
            ready_contract(page, ready, spec)
            expected_language = language
            expected_theme = spec.get("saved", {}).get("theme", spec["theme"])
            check(ready["lang"] == expected_language and ready["theme"] == expected_theme, ("preferences keep priority", ready["lang"],
                                                                                            ready["theme"]))
            check(ready["focus"] == "BODY", ("the startup does not move the focus", ready["focus"]))
            scripts = page.locator("head script[src]").evaluate_all(
                "els => els.map(el => ({src: el.getAttribute('src'), defer: el.defer, async: el.async}))")
            check([s["src"] for s in scripts] == SCRIPTS, ("script order", scripts))
            check(not scripts[0]["defer"] and not scripts[0]["async"] and all(s["defer"] and not s["async"] for s in scripts[1:]),
                  "theme-init.js is synchronous and the rest are deferred")
            if spec.get("separate"):
                result["preferences"] = preference_separation(page, spec)
            if spec.get("storage_denied"):
                page.locator("#theme").click()
                page.locator("#language").click()
                check(page.locator("html").get_attribute("lang") == "ja", "the language works without storage")
                check(page.locator("html").get_attribute("data-theme") == "light", "the theme works without storage")
                page.locator("#card-simswap").click()
                check(page.locator("#card-simswap").get_attribute("aria-pressed") == "true", "the map works without storage")
        evidence = page.evaluate("() => window.__startup || {csp: []}")
        check(not evidence["csp"], ("no CSP violation", evidence["csp"]))
        if spec.get("fail"):
            check(failures and all(url_.split("?")[0].endswith("/" + spec["fail"]) for url_ in failures), ("only the held file fails", failures))
            check(all(spec.get("missing", "NO_ERROR_EXPECTED") in error for error in errors), ("only the missing global fails", errors))
        else:
            check(not errors and not failures and not console, ("no startup error", errors, failures, console))
        result["status"] = "passed"
    except Exception as error:
        result.update(status="failed", error=str(error))
    finally:
        release(held["app"])
        release(held["css"])
        result.update(page_errors=errors, request_failures=failures, console_errors=console)
        context.close()
        browser.close()
    (output / (spec["name"] + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(spec["name"], result["status"], result.get("error", ""), flush=True)
    return result


def release(routes):
    while routes:
        try:
            routes.pop().continue_()
        except Exception:
            pass


@contextmanager
def local_http():
    """Serve the repository on an ephemeral loopback port; the server stops when the block ends."""
    class QuietHandler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".css": "text/css",
                          ".json": "application/json", ".html": "text/html"}

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:" + str(server.server_address[1]) + "/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = ROOT.resolve()

    def inside_repository(path):
        return path == root or root in path.parents

    # Check the place before creating anything, so that a refused --output leaves no folder behind.
    if args.output:
        output = args.output.resolve()
        check(not inside_repository(output), "Write results outside the repository")
        output.mkdir(parents=True, exist_ok=True)
    else:
        check(not inside_repository(Path(tempfile.gettempdir()).resolve()), "Write results outside the repository")
        output = Path(tempfile.mkdtemp(prefix="account-domino-mapper-")).resolve()

    def sources():
        return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}

    before = sources()
    report = {"sources_before": before, "cases": []}
    with local_http() as url, sync_playwright() as playwright:
        for spec in CASES:
            report["cases"].append(run_case(playwright, url, spec, output))
            (output / "report.partial.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report["sources_after"] = sources()
    report["sources_stable"] = before == report["sources_after"]
    report["passed"] = sum(case["status"] == "passed" for case in report["cases"])
    report["failed"] = len(report["cases"]) - report["passed"]
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{report['passed']} passed, {report['failed']} failed; {output}", flush=True)
    return bool(report["failed"] or not report["sources_stable"])


if __name__ == "__main__":
    raise SystemExit(main())
