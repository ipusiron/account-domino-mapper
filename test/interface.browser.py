"""Browser gates for Account Domino Mapper (Playwright for Python; not part of CI).

Run with a Python environment that already contains Playwright:
    python test/interface.browser.py --stage 1a
    python test/interface.browser.py --stage 1a --output <folder>
    python test/interface.browser.py --stage 1a --url http://127.0.0.1:8000/
Results and viewport screenshots are written to --output (default: a new folder in the
system temporary directory). Nothing is written inside the repository.
"""
import argparse
import base64
import json
import re
import sys
import tempfile
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "account-domino-mapper."
STAGES = ("1a",)
WIDTHS = (320, 390, 720, 808, 1280)
HTTP_WIDTHS = (320, 1280)
TABS = ("chain", "lockout", "compare", "rules")
PEOPLE = ("worker", "parent", "student")
TAB_LABELS = {
    "ja": ("連鎖を追う", "閉め出し", "1手で比べる", "規則表"),
    "en": ("Follow the chain", "Lockout", "Try one change", "Rules"),
}
PANEL_HEADINGS = {
    "ja": ("連鎖を追う", "閉め出し", "1手で比べる", "規則表（単純化した模型）"),
    "en": ("Follow the chain", "Lockout", "Try one change", "Rules (a simplified model)"),
}
PERSON_LABELS = {
    "ja": ("会社員 ハルト", "高齢の親 シズエ", "学生 ミオ"),
    "en": ("Haruto, office worker", "Shizue, older parent", "Mio, student"),
}
PERSON_HEADING = {"ja": "人物（架空）", "en": "Person (fictional)"}
PERSON_COUNTS = {
    "ja": "アカウント{n}・パスワードの系統{f}。架空の人物で、本物のアカウントの情報を入れる欄はありません。",
    "en": "Accounts: {n} · Password families: {f}. These are fictional people; there are no fields for real account details.",
}
STATUS_PERSON = {"ja": "人物：{person}", "en": "Person: {person}"}
FOOTER = {"ja": "GitHub（ipusiron/account-domino-mapper）", "en": "GitHub (ipusiron/account-domino-mapper)"}
FOOTER_HREF = "https://github.com/ipusiron/account-domino-mapper"
# The 22 help terms in the order of the terms table, written out here rather than taken from messages.js or index.html:
# key, then the term and its meaning in Japanese, then the term and its meaning in English.
HELP_TERMS = (
    ("termAccount",
     "アカウント", "メール・銀行・SNSなどの1つ。地図の表の1行（広い画面の図では、資格情報より右に並ぶ箱）",
     "Account", "One email, bank, social media or other account; "
                "one row of the map table (a box to the right of the credentials in the diagram on wide screens)"),
    ("termEntrance",
     "入口", "1つのアカウントに入る手段。ログインの入口と復旧の入口がある",
     "Entrance", "A way into one account: a log-in entrance or a recovery entrance"),
    ("termRequirement",
     "条件", "入口に要るもの。2つ以上なら「かつ」",
     "Requirement", "What an entrance needs; two or more are joined by AND"),
    ("termAndOr",
     "かつ／または", "1つの入口の条件はすべて要る／入口はどれか1つ開けばよい",
     "AND / OR", "Every requirement of one entrance is needed / any one entrance is enough"),
    ("termFamily",
     "系統", "パスワードを色と英字で表したもの（赤A）。同じ系統は使い回し（少し変えたものを含む）",
     "Password family", "A password shown as a color and a letter (Red A). "
                        "The same family means reuse, small variations included"),
    ("termLineType",
     "線の種類", "パスワードの系統・多要素・メール・SMS・窓口・紙の回復コードの6種",
     "Line type", "Six kinds: password family, multi-factor, email, SMS, help desk and paper recovery codes"),
    ("termAttackCard",
     "攻撃カード", "攻撃者が最初に手にするもの（漏えい・SIMスワップ・メールの乗っ取り・窓口のなりすまし）",
     "Attack card", "What the attacker starts with (breach, SIM swap, email takeover, help-desk impersonation)"),
    ("termFalls",
     "倒れる", "攻撃者がそのアカウントに入れるようになること",
     "Falls", "The attacker can get into the account"),
    ("termStep",
     "段", "段0はカードが渡したもの。段rは、条件がすべて段r−1までにそろった入口で開いたもの",
     "Step", "Step 0 is what the card gives. "
             "Step r is what opens through an entrance whose requirements were all met by step r−1"),
    ("termEntranceUsed",
     "開けた入口", "そのアカウントを開いた入口",
     "Entrance used", "The entrance that opened the account"),
    ("termBackdoor",
     "裏口", "そのカードで倒れるが、復旧の入口をすべて外すと倒れないアカウント。開けた入口がログインでも、その条件のメールが復旧の線で倒れていれば裏口",
     "Backdoor", "An account that falls to the card but would not fall if every recovery entrance were removed. "
                 "This includes an account opened through log-in whose required email fell through a recovery line"),
    ("termLossCard",
     "喪失カード", "本人が失うもの（スマホをなくした・電話番号を手放した・メールが消えた・紙の回復コードをなくした）",
     "Loss card", "What the owner loses (the phone, the phone number, an email account or the paper recovery codes)"),
    ("termLocked",
     "閉め出し（×）", "失ったあと、手元に残ったもので入れないこと",
     "Locked out (×)", "After a loss, the owner cannot get in with what remains"),
    ("termGone",
     "消", "メールのアカウントそのものが消えた状態。閉め出しには数えない",
     "Gone", "The email account itself has disappeared; it is not counted as locked out"),
    ("termOneMore",
     "あと1つ失うと×", "○の後ろの「（＋番号で×）」。それも一緒に失うと入れない",
     "One more loss locks you out", "The “(× if the number goes too)” after ○: "
                                    "losing that as well locks the owner out"),
    ("termTwoAtOnce",
     "2つ同時", "2つを同時に失ったときだけ閉め出される",
     "Two at once", "Locked out only when two things are lost together"),
    ("termChange",
     "1手", "足す・付け替える・外すのどれか1つで、入口を1つ変える（条件が2つの入口を外すと、線は2本なくなる）",
     "One change", "Add, replace or remove: "
                   "one entrance changes (removing an entrance with two requirements removes two lines)"),
    ("termSaved",
     "守れた／新たに倒れる", "手の前は倒れ、手のあとは倒れない／その逆",
     "Saved / Newly fallen", "Fell before the change but not after / the reverse"),
    ("termUnlocked",
     "解ける／新たに×", "手の前は閉め出され、手のあとは入れる／その逆",
     "Unlocked / Newly locked out", "Locked out before the change but not after / the reverse"),
    ("termSum",
     "延べ", "4枚のカードごとに数えて足した数（同じアカウントを2回以上数えることがある）",
     "Sum over the four cards", "Counted for each of the four cards and added up "
                                "(the same account can be counted more than once)"),
    ("termImportant",
     "★", "重要なアカウント（並べ方で先に数える）",
     "★ Important", "An important account (counted first when ranking)"),
    ("termHoldings",
     "手元", "本人が直接持つもの",
     "What the owner holds", "What the owner holds directly"),
)
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; base-uri 'none'; form-action 'none'; "
    "frame-src 'none'; object-src 'none'; connect-src 'none'"
)
JAPANESE = re.compile("[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠]")
PROBE = """() => {
  const visible = el => el.getClientRects().length > 0;
  const label = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
    + (el.dataset && el.dataset.key ? '[' + el.dataset.key + ']' : '');
  const px = n => Math.round(n * 1000) / 1000;
  const size = el => ({w: px(el.getBoundingClientRect().width),
    h: px(Math.min(...Array.from(el.getClientRects(), rect => rect.height)))});
  const inline = el => el.tagName === 'A' && el.parentElement &&
    el.parentElement.textContent.trim() !== el.textContent.trim();
  const small = Array.from(document.querySelectorAll(
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"]'))
    .filter(visible).filter(el => !inline(el)).map(el => ({el: label(el), ...size(el)}))
    .filter(item => item.w < 44 || item.h < 44);
  const wraps = Array.from(document.querySelectorAll('body *')).filter(visible)
    .filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
    .filter(el => el.scrollWidth > el.clientWidth).map(el => ({
      el: label(el), width: el.clientWidth, scroll: el.scrollWidth
    }));
  // The text of each line, measured one character at a time (recorded to show where a label breaks).
  const lines = el => {
    const node = el.firstChild, rows = [];
    if (!node || node.nodeType !== Node.TEXT_NODE) return [el.textContent];
    let top = null;
    for (let i = 0; i < node.length; i++) {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      if (!rows.length || (rect.height > 0 && Math.abs(rect.top - top) > 2)) { rows.push(''); top = rect.top; }
      rows[rows.length - 1] += node.data[i];
    }
    return rows.map(row => row.trim());
  };
  const tabMetrics = Array.from(document.querySelectorAll('[role="tab"]'), el => {
    const css = getComputedStyle(el), range = document.createRange();
    range.selectNodeContents(el);
    return {el: label(el), size: parseFloat(css.fontSize),
      line: parseFloat(css.lineHeight), height: range.getBoundingClientRect().height, lines: lines(el)};
  });
  return {
    viewport: innerWidth, client: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    rootOverflow: getComputedStyle(document.documentElement).overflowX,
    bodyOverflow: getComputedStyle(document.body).overflowX,
    small, wraps, tabMetrics
  };
}"""
SNAPSHOT = """() => {
  const note = document.querySelector('#startup-note');
  return {
    ready: document.documentElement.dataset.appReady,
    theme: document.documentElement.dataset.theme || null,
    lang: document.documentElement.lang,
    toolsDisabled: document.querySelector('#startup-tools').disabled,
    controlsDisabled: document.querySelector('#startup-controls').disabled,
    allDisabled: Array.from(document.querySelectorAll('#startup-tools button, #startup-controls button'))
      .every(button => button.matches(':disabled')),
    noteVisible: !!note && note.getClientRects().length > 0,
    note: note ? note.innerText : '',
    h1: document.querySelector('h1').innerText,
    tabs: Array.from(document.querySelectorAll('[role="tab"]'), tab => tab.innerText),
    personHeading: document.querySelector('#person-heading').innerText,
    intro: document.querySelector('.intro').innerText,
    counts: document.querySelector('#person-counts').innerText,
    unnamed: Array.from(document.querySelectorAll('button')).filter(button => button.getClientRects().length
      && !button.textContent.trim() && !button.getAttribute('aria-label')).map(button => button.id),
    active: document.activeElement === document.body ? 'BODY' : (document.activeElement.id || document.activeElement.tagName)
  };
}"""
HEADING_LEVELS = """() => Array.from(document.querySelectorAll('h1, h2, h3, h4'), el => Number(el.tagName[1]))"""
# The children of the help's term list in document order: tag, text key and text.
GLOSSARY = """() => Array.from(document.querySelectorAll('#help-terms > *'), el => ({
  tag: el.tagName.toLowerCase(), key: el.dataset.i18n || null, text: el.textContent.trim()}))"""
# The focus mark of one element, read the same way for every control.
FOCUS_RING = """el => {
  const css = getComputedStyle(el);
  return {active: document.activeElement === el, style: css.outlineStyle,
    width: parseFloat(css.outlineWidth), color: css.outlineColor};
}"""
# Runs before the page's own scripts. The object that domino-core.js assigns to window.DominoCore is replaced by a copy
# whose personaVectors counts its calls per person (the id of the person passed in), so the count does not depend on
# how the page keeps its results.
COUNT_PERSONA_VECTORS = """(() => {
  const calls = {};
  let core;
  Object.defineProperty(window, '__qaPersonaVectorsCalls', {value: calls});
  Object.defineProperty(window, 'DominoCore', {
    configurable: true, enumerable: true,
    get() { return core; },
    set(value) {
      const original = value && value.personaVectors;
      if (typeof original !== 'function') { core = value; return; }
      core = Object.freeze({...value, personaVectors(...args) {
        const person = args[0], id = person && typeof person.id === 'string' ? person.id : String(person);
        calls[id] = (calls[id] || 0) + 1;
        return original.apply(value, args);
      }});
    }
  });
})();"""


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def set_language_query(url, value):
    parts = urlsplit(url)
    query = [(key, item) for key, item in parse_qsl(parts.query) if key != "lang"]
    if value is not None:
        query.append(("lang", value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def load_counts():
    """Accounts and password families per person, read directly from the test data."""
    sample = json.loads((ROOT / "test" / "sample.json").read_text(encoding="utf-8"))
    counts = {}
    for person in sample["personas"]:
        families = {c.get("family") for c in person["credentials"] if c["type"] == "pw"}
        counts[person["id"]] = (len(person["services"]), len(families))
    return counts


def observe(page, url):
    """Collect page errors, console errors, failed or unexpected requests and CSP violations (also across reloads)."""
    errors, violations = [], []
    allowed = urlsplit(url)

    def request_sent(request):
        target = urlsplit(request.url)
        if target.scheme in ("http", "https") and (
            target.scheme != allowed.scheme or target.netloc != allowed.netloc
        ):
            errors.append("Unexpected network request: " + request.url)

    page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
    page.on("console", lambda message: errors.append("console: " + message.text)
            if message.type == "error" else None)
    page.on("requestfailed", lambda request: errors.append(
        "requestfailed: " + request.url + " " + str(request.failure)))
    page.on("request", request_sent)
    page.expose_function("__qaCspViolation", lambda directive, blocked: violations.append(
        {"directive": directive, "blocked": blocked}))
    page.add_init_script("""document.addEventListener('securitypolicyviolation', event => {
        window.__qaCspViolation(event.violatedDirective, event.blockedURI);
      });""")
    return errors, violations


def assert_clean(errors, violations):
    check(not errors, errors)
    check(not violations, violations)


def count_persona_vectors(page):
    """Count the page's calls of DominoCore.personaVectors per person (also across reloads)."""
    page.add_init_script(COUNT_PERSONA_VECTORS)


def assert_vectors_built(page, name, everyone=False):
    """personaVectors is built at most once per person and then kept: changing the person, tab, language or theme
    redraws without building again. The first person is built before the page is ready; with everyone=True every
    person has been shown, so each has been built exactly once."""
    calls = page.evaluate("() => ({...window.__qaPersonaVectorsCalls})")
    if everyone:
        check(calls == {person: 1 for person in PEOPLE}, (name, "personaVectors calls", calls))
    else:
        check(set(calls) <= set(PEOPLE) and calls.get(PEOPLE[0]) == 1 and all(n <= 1 for n in calls.values()),
              (name, "personaVectors calls", calls))


def focus_ring(page, selector, name):
    """The element has the focus and shows the focus mark (an outline)."""
    ring = page.locator(selector).evaluate(FOCUS_RING)
    check(ring["active"] and ring["style"] != "none" and ring["width"] > 0, (name, "focus mark", ring))
    return ring


def wait_ready(page):
    page.wait_for_function("() => document.documentElement.dataset.appReady === 'true'")


def assert_layout(page, width, name, results):
    measured = page.evaluate(PROBE)
    check(measured["viewport"] == width, (name, measured))
    check(measured["page"] <= measured["client"], (name, "page overflow", measured))
    check(measured["rootOverflow"] not in ("hidden", "clip"), (name, measured))
    check(measured["bodyOverflow"] not in ("hidden", "clip"), (name, measured))
    check(not measured["small"], (name, "small targets", measured["small"]))
    check(not measured["wraps"], (name, "scrolling boxes", measured["wraps"]))
    for tab in measured["tabMetrics"]:
        check(tab["size"] >= 14, (name, tab))
        check(tab["height"] <= tab["line"] * 2 + 1, (name, "tab text over two lines", tab))
    results.append({"state": name, **measured})


def assert_selected(page, name):
    for tab_name in TABS:
        selected = tab_name == name
        tab = page.locator("#tab-" + tab_name)
        panel = page.locator("#panel-" + tab_name)
        check(tab.get_attribute("aria-selected") == str(selected).lower(), tab_name)
        check(tab.get_attribute("tabindex") == ("0" if selected else "-1"), tab_name)
        check(tab.get_attribute("aria-controls") == "panel-" + tab_name, tab_name)
        check(panel.get_attribute("aria-labelledby") == "tab-" + tab_name, tab_name)
        check(panel.is_visible() == selected, ("panel visibility", tab_name))


def assert_language_text(text, language, name):
    check(bool(text and text.strip()), (name, "empty"))
    check(bool(JAPANESE.search(text)) == (language == "ja"), (name, language, text))


def assert_preference(page, language, theme):
    check(page.locator("html").get_attribute("lang") == language, "language " + language)
    check(page.locator("html").get_attribute("data-theme") == theme, "theme " + theme)
    labels = tuple(page.locator("#tab-" + tab).inner_text() for tab in TABS)
    check(labels == TAB_LABELS[language], labels)
    for control in ("theme", "language", "help"):
        assert_language_text(page.locator("#" + control).get_attribute("aria-label"), language, control)
    check(page.locator("#language").inner_text() == ("EN" if language == "ja" else "日"), "language button text")


def assert_ready_state(page, language):
    """Startup type after readiness: notice removed, both groups released and labelled in the current language."""
    check(page.locator("html").get_attribute("data-app-ready") == "true", "ready marker")
    check(page.locator("#startup-note").count() == 0, "startup notice is removed from the DOM")
    for group in ("startup-tools", "startup-controls"):
        locator = page.locator("#" + group)
        check(not locator.evaluate("el => el.disabled"), group + " released")
        label = locator.get_attribute("aria-label")
        assert_language_text(label, language, group)
        check(" / " not in label, (group, "bilingual startup label remains", label))
    assert_language_text(page.locator(".tabs").get_attribute("aria-label"), language, "tablist")


def assert_heading(page, language):
    check(page.locator("h1").count() == 1, "one h1")
    check(page.locator("h1").inner_text() == "Account Domino Mapper", "h1 text")
    header = page.locator("header.page-header")
    check(not re.search(r"day\s*\d", header.inner_text(), re.I), "no Day line in the header")
    check(header.locator("p").count() == 0, "no decorative line in the header")
    check(header.locator("button").count() == 3, "three round buttons")
    for control in ("theme", "language", "help"):
        box = page.locator("#" + control).bounding_box()
        check(box["width"] >= 44 and box["height"] >= 44, (control, box))
    footer = page.locator("footer a")
    check(footer.count() == 1, "one footer link")
    check(footer.inner_text() == FOOTER[language], footer.inner_text())
    check(footer.get_attribute("href") == FOOTER_HREF, "footer href")
    check(footer.get_attribute("target") == "_blank", "footer target")
    check(footer.get_attribute("rel") == "noopener noreferrer", "footer rel")
    levels = page.evaluate(HEADING_LEVELS)
    check(levels[0] == 1 and all(b - a <= 1 for a, b in zip(levels, levels[1:])), ("heading levels", levels))


def assert_person(page, person, language, counts):
    for index, other in enumerate(PEOPLE):
        button = page.locator("#person-" + other)
        check(button.get_attribute("aria-pressed") == str(other == person).lower(), (person, other))
        check(button.inner_text() == PERSON_LABELS[language][index], button.inner_text())
    accounts, families = counts[person]
    text = page.locator("#person-counts").inner_text()
    check(text == PERSON_COUNTS[language].format(n=accounts, f=families), (person, text))


def test_person_band(page, width, layouts, language, counts):
    heading = page.locator("#person-heading")
    check(heading.evaluate("el => el.tagName") == "H2", "person heading is h2")
    check(heading.inner_text() == PERSON_HEADING[language], heading.inner_text())
    group = page.locator(".person-buttons")
    check(group.get_attribute("role") == "group", "person group role")
    check(group.get_attribute("aria-labelledby") == "person-heading", "person group label")
    status = page.locator("#person-status")
    check(status.get_attribute("role") == "status" and status.get_attribute("aria-live") == "polite", "person status")
    check(status.inner_text() == "", "no announcement before a change")
    assert_person(page, "worker", language, counts)
    for person, by_keyboard in (("parent", True), ("student", False), ("worker", True)):
        button = page.locator("#person-" + person)
        if by_keyboard:
            button.focus()
            page.keyboard.press("Enter")
            check(page.evaluate("() => document.activeElement.id") == "person-" + person, "focus stays on " + person)
        else:
            button.click()
        assert_person(page, person, language, counts)
        label = PERSON_LABELS[language][PEOPLE.index(person)]
        check(status.text_content() == STATUS_PERSON[language].format(person=label), status.text_content())
        assert_layout(page, width, "person-" + person, layouts)
    assert_vectors_built(page, "after moving between the people", everyone=True)


def test_tabs(page, width, layouts, language):
    check(page.locator('[role="tablist"]').count() == 1, "one tablist")
    check(page.locator('[role="tab"]').count() == 4, "four tabs")
    check(page.locator('[role="tabpanel"]').count() == 4, "four panels")
    assert_selected(page, "chain")
    for person in PEOPLE:
        page.locator("#person-" + person).click()
        for index, tab in enumerate(TABS):
            page.locator("#tab-" + tab).click()
            assert_selected(page, tab)
            heading = page.locator("#panel-" + tab + " h2")
            check(heading.inner_text() == PANEL_HEADINGS[language][index], heading.inner_text())
            assert_layout(page, width, person + "-" + tab, layouts)
    page.locator("#person-worker").click()
    assert_vectors_built(page, "after moving between people and tabs", everyone=True)
    page.locator("#tab-chain").click()
    page.locator("#tab-chain").focus()
    for key, expected in (("ArrowRight", "lockout"), ("ArrowRight", "compare"), ("ArrowLeft", "lockout"),
                          ("End", "rules"), ("ArrowRight", "chain"), ("ArrowLeft", "rules"), ("Home", "chain")):
        page.keyboard.press(key)
        assert_selected(page, expected)
        check(page.evaluate("() => document.activeElement.id") == "tab-" + expected, ("tab focus", key, expected))
    # Tab moves from the selected tab into its panel and Shift+Tab moves back. The panels that are not selected are
    # hidden, so Tab never stops on them. The panel shows the same focus mark as the tab.
    for index, name in enumerate(TABS):
        if index:
            page.keyboard.press("ArrowRight")
        assert_selected(page, name)
        tab_ring = focus_ring(page, "#tab-" + name, ("selected tab", name))
        page.keyboard.press("Tab")
        panel_ring = focus_ring(page, "#panel-" + name, ("Tab from the selected tab enters its panel", name))
        mark = ("style", "width", "color")
        check([panel_ring[k] for k in mark] == [tab_ring[k] for k in mark], ("same focus mark", name, tab_ring, panel_ring))
        page.keyboard.press("Shift+Tab")
        check(page.evaluate("() => document.activeElement.id") == "tab-" + name, ("Shift+Tab returns to the tab", name))
    page.keyboard.press("Home")
    assert_selected(page, "chain")


def test_help(page, width, layouts, screenshot, language):
    page.locator("#help").focus()
    page.keyboard.press("Enter")
    dialog = page.locator("#help-dialog")
    check(dialog.is_visible(), "help is visible")
    check(dialog.evaluate("el => el.open && el.matches(':modal')"), "modal dialog")
    check(dialog.get_attribute("aria-labelledby") == "help-title", "help title")
    assert_language_text(page.locator("#help-title").inner_text(), language, "help title")
    check(dialog.locator("header").count() == 0, "no header (banner landmark) inside the help dialog")
    body = dialog.locator(".help-body")
    check(body.get_attribute("role") == "region" and body.get_attribute("tabindex") == "0", "scrollable help text")
    check(body.get_attribute("aria-labelledby") is None, "the help text is not labelled by the dialog title")
    body_label = body.get_attribute("aria-label")
    assert_language_text(body_label, language, "help text label")
    check(body_label != page.locator("#help-title").inner_text(), "the help text is named apart from the dialog")
    # The 22 terms in the order of the table, each term followed directly by its meaning, in the current language.
    check(len(HELP_TERMS) == 22, "22 terms")
    expected = []
    for key, ja, ja_meaning, en, en_meaning in HELP_TERMS:
        term, meaning = (ja, ja_meaning) if language == "ja" else (en, en_meaning)
        expected += [{"tag": "dt", "key": key, "text": term}, {"tag": "dd", "key": key + "Meaning", "text": meaning}]
    items = page.evaluate(GLOSSARY)
    check(items == expected, ("help terms", len(items), [pair for pair in zip(items, expected) if pair[0] != pair[1]][:3]))
    text = dialog.inner_text()
    if language == "en":
        check(not JAPANESE.search(text), ("Japanese in the English help", JAPANESE.findall(text)[:10]))
    active = "() => document.activeElement.id || document.activeElement.className"
    check(page.evaluate(active) == "close-help", "help opens on the close button")
    page.keyboard.press("Tab")
    check(page.evaluate(active) == "help-body", "Tab reaches the scrollable help text")
    page.keyboard.press("Tab")
    check(page.evaluate(active) == "close-help", "Tab cycles back to the close button")
    page.keyboard.press("Shift+Tab")
    check(page.evaluate(active) == "help-body", "Shift+Tab cycles to the last item")
    for key in ("Tab", "Tab", "Shift+Tab", "Shift+Tab"):
        page.keyboard.press(key)
        check(dialog.evaluate("el => el.contains(document.activeElement)"), "dialog focus trap")
    assert_layout(page, width, "help-open", layouts)
    box = dialog.bounding_box()
    check(box["x"] >= 0 and box["x"] + box["width"] <= width + 0.5, box)
    page.screenshot(path=str(screenshot), full_page=False)
    page.keyboard.press("Escape")
    check(not dialog.is_visible(), "Escape closes help")
    check(page.evaluate("() => document.activeElement.id") == "help", "help focus restored after Escape")
    page.keyboard.press("Enter")
    check(dialog.is_visible(), "help reopens")
    page.locator("#close-help").click()
    check(not dialog.is_visible(), "close button closes help")
    check(page.evaluate("() => document.activeElement.id") == "help", "help focus restored after Close")


def test_preferences_interaction(page, language, theme, counts):
    other_language = "en" if language == "ja" else "ja"
    other_theme = "dark" if theme == "light" else "light"
    page.locator("#tab-compare").click()
    page.locator("#person-parent").click()
    original_url = page.url
    page.locator("#language").click()
    page.locator("#theme").click()
    assert_preference(page, other_language, other_theme)
    assert_ready_state(page, other_language)
    assert_selected(page, "compare")
    assert_person(page, "parent", other_language, counts)
    assert_vectors_built(page, "after changing the language and the theme", everyone=True)
    check(page.locator("#person-status").text_content() == "", "a language change clears the announcement")
    check(page.url == original_url, "preference controls changed the URL")
    saved = page.evaluate("() => Object.fromEntries(Object.entries(localStorage))")
    check(saved == {PREFIX + "language": other_language, PREFIX + "theme": other_theme}, saved)
    page.reload()
    wait_ready(page)
    assert_vectors_built(page, "after reloading")
    assert_preference(page, other_language, other_theme)
    assert_selected(page, "chain")
    assert_person(page, "worker", other_language, counts)
    return saved


def new_context(browser, browser_name, width, language, theme):
    options = {
        "viewport": {"width": width, "height": 900},
        "locale": "ja-JP" if language == "ja" else "en-US",
        "color_scheme": theme, "reduced_motion": "reduce",
        "has_touch": browser_name == "chromium" and width < 720,
    }
    if browser_name == "chromium":
        options["is_mobile"] = width < 720
    return browser.new_context(**options)


def matrix_case(browser, browser_name, url, width, language, theme, output, counts):
    name = f"{browser_name}-{width}-{language}-{theme}"
    context = new_context(browser, browser_name, width, language, theme)
    page = context.new_page()
    errors, violations = observe(page, url)
    count_persona_vectors(page)
    layouts = []
    try:
        page.goto(set_language_query(url, None), wait_until="load")
        wait_ready(page)
        assert_vectors_built(page, "startup")
        check(page.title() == "Account Domino Mapper", "document title")
        check(page.locator("main").count() == 1, "single main")
        check(page.locator('meta[name="viewport"]').get_attribute("content")
              == "width=device-width, initial-scale=1", "viewport")
        check(page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content") == CSP, "CSP")
        check(page.locator('meta[name="referrer"]').get_attribute("content") == "no-referrer", "referrer")
        check(page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches"), "reduced motion")
        assert_preference(page, language, theme)
        assert_ready_state(page, language)
        assert_heading(page, language)
        assert_layout(page, width, "initial", layouts)
        page.screenshot(path=str(output / (name + "-initial.png")), full_page=False)
        test_person_band(page, width, layouts, language, counts)
        test_tabs(page, width, layouts, language)
        test_help(page, width, layouts, output / (name + "-help.png"), language)
        saved = test_preferences_interaction(page, language, theme, counts)
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "layouts": layouts, "saved": saved}
    except Exception as error:
        page.screenshot(path=str(output / (name + "-failed.png")), full_page=False)
        return {"case": name, "status": "failed", "error": str(error), "errors": errors,
                "violations": violations, "layouts": layouts}
    finally:
        context.close()


def precedence_cases(browser, browser_name, url):
    cases = (
        ("saved-en", "ja", "light", {"language": "en", "theme": "dark"}, None, "en", "dark"),
        ("saved-ja", "en", "dark", {"language": "ja", "theme": "light"}, None, "ja", "light"),
        ("query-ja", "en", "light", {"language": "en", "theme": "dark"}, "ja", "ja", "dark"),
        ("query-en", "ja", "dark", {"language": "ja", "theme": "light"}, "en", "en", "light"),
        ("invalid-query", "ja", "light", {"language": "en", "theme": "dark"}, "xx", "en", "dark"),
        ("invalid-saved", "en", "dark", {"language": "xx", "theme": "xx"}, None, "en", "dark"),
        ("blocked-storage", "ja", "dark", None, None, "ja", "dark"),
    )
    results = []
    for name, locale, system_theme, stored, query, language, theme in cases:
        context = new_context(browser, browser_name, 390, locale, system_theme)
        if stored is None:
            context.add_init_script("""Object.defineProperty(window, 'localStorage', {
              get() { throw new DOMException('Unavailable for test', 'SecurityError'); }
            });""")
        else:
            values = {PREFIX + key: value for key, value in stored.items()}
            context.add_init_script("""(() => {
              const saved = """ + json.dumps(values) + """;
              for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
            })();""")
        page = context.new_page()
        errors, violations = observe(page, url)
        count_persona_vectors(page)
        try:
            page.goto(set_language_query(url, query), wait_until="load")
            wait_ready(page)
            assert_vectors_built(page, "startup")
            assert_preference(page, language, theme)
            assert_ready_state(page, language)
            page.locator("#language").click()
            page.locator("#theme").click()
            assert_preference(page, "en" if language == "ja" else "ja", "dark" if theme == "light" else "light")
            assert_vectors_built(page, "after changing the language and the theme")
            assert_clean(errors, violations)
            results.append({"case": browser_name + "-" + name, "status": "passed"})
        except Exception as error:
            results.append({"case": browser_name + "-" + name, "status": "failed",
                            "error": str(error), "errors": errors, "violations": violations})
        finally:
            context.close()
    return results


def startup_case(browser, browser_name, base_url, width, language, theme, output):
    """Startup type: while app.js is held, static Japanese text is readable and the controls stay disabled."""
    name = f"{browser_name}-{width}-{language}-{theme}-startup"
    context = new_context(browser, browser_name, width, language, theme)
    page = context.new_page()
    errors, violations = observe(page, base_url)
    count_persona_vectors(page)
    held = []
    page.route("**/app.js", lambda route: held.append(route))
    try:
        page.goto(set_language_query(base_url, language), wait_until="commit")
        page.wait_for_function("() => !!document.querySelector('#panel-rules') && document.readyState !== 'loading'")
        page.wait_for_timeout(200)
        check(len(held) == 1, "app.js is held")
        pending = page.evaluate(SNAPSHOT)
        check(pending["ready"] == "false", "unfinished application must not signal readiness")
        check(pending["toolsDisabled"] and pending["controlsDisabled"] and pending["allDisabled"],
              "both groups stay disabled until ready")
        check(pending["noteVisible"] and "準備中" in pending["note"] and "Loading" in pending["note"],
              ("bilingual startup notice", pending["note"]))
        check(pending["h1"] == "Account Domino Mapper", "static heading")
        check(tuple(pending["tabs"]) == TAB_LABELS["ja"], ("static Japanese tabs", pending["tabs"]))
        check(pending["personHeading"] == PERSON_HEADING["ja"], "static person heading")
        check(JAPANESE.search(pending["intro"]) and JAPANESE.search(pending["counts"]), "static Japanese text")
        check(pending["theme"] == theme, "theme is decided before the application")
        check(not pending["unnamed"], ("unnamed buttons", pending["unnamed"]))
        page.locator("#startup-help > summary").click()
        check(page.locator("#startup-reload").is_visible(), "reload link is visible")
        check(page.locator("#startup-reload").evaluate("el => el.href === location.href"), "reload keeps the URL")
        check(page.locator("#startup-reload").get_attribute("target") == "_blank", "reload opens a new tab")
        page.locator("#startup-help > summary").click()
        if browser_name == "chromium":
            # page.screenshot waits for the load event, which the held script delays; capture through CDP instead.
            cdp = context.new_cdp_session(page)
            captured = cdp.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
            (output / (name + "-pending.png")).write_bytes(base64.b64decode(captured["data"]))
        release(held)
        wait_ready(page)
        assert_vectors_built(page, "startup")
        assert_ready_state(page, language)
        assert_preference(page, language, theme)
        ready = page.evaluate(SNAPSHOT)
        check(ready["active"] == "BODY", ("startup does not move the focus", ready["active"]))
        assert_clean(errors, violations)
        page.screenshot(path=str(output / (name + "-ready.png")), full_page=False)
        return {"case": name, "status": "passed", "pending": pending, "ready": ready}
    except Exception as error:
        release(held)
        try:
            page.screenshot(path=str(output / (name + "-failed.png")), full_page=False, timeout=5000)
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        release(held)
        context.close()


def release(routes):
    while routes:
        try:
            routes.pop().continue_()
        except Exception:
            pass


def http_case(browser, browser_name, base_url, width, output, counts):
    name = f"{browser_name}-{width}-http"
    context = new_context(browser, browser_name, width, "en", "dark")
    page = context.new_page()
    errors, violations = observe(page, base_url)
    count_persona_vectors(page)
    layouts = []
    try:
        page.goto(base_url, wait_until="load")
        wait_ready(page)
        assert_vectors_built(page, "startup")
        check(page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content") == CSP, "CSP")
        assert_preference(page, "en", "dark")
        assert_ready_state(page, "en")
        assert_heading(page, "en")
        assert_layout(page, width, "http-initial", layouts)
        test_person_band(page, width, layouts, "en", counts)
        test_tabs(page, width, layouts, "en")
        test_help(page, width, layouts, output / (name + "-help.png"), "en")
        page.locator("#language").click()
        page.locator("#theme").click()
        assert_preference(page, "ja", "light")
        assert_vectors_built(page, "after changing the language and the theme", everyone=True)
        assert_layout(page, width, "http-ja-light", layouts)
        assert_clean(errors, violations)
        page.screenshot(path=str(output / (name + ".png")), full_page=False)
        return {"case": name, "status": "passed", "url": base_url, "layouts": layouts}
    except Exception as error:
        page.screenshot(path=str(output / (name + "-failed.png")), full_page=False)
        return {"case": name, "status": "failed", "error": str(error), "errors": errors,
                "violations": violations, "layouts": layouts}
    finally:
        context.close()


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
    parser.add_argument("--stage", choices=STAGES, default=STAGES[-1])
    parser.add_argument("--url", default=(ROOT / "index.html").as_uri())
    parser.add_argument("--browser", choices=("chromium", "firefox"), action="append")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    check(urlsplit(args.url).scheme in ("file", "http", "https"), "Use a file:// or HTTP(S) URL")
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
    counts = load_counts()
    report = {"stage": args.stage, "url": args.url, "browsers": {}, "cases": []}

    def record(result):
        report["cases"].append(result)
        (output / (result["case"] + "-result.json")).write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        (output / "report.partial.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(result["case"], result["status"], result.get("error", ""), flush=True)

    with sync_playwright() as playwright:
        for browser_name in args.browser or ("chromium", "firefox"):
            browser = getattr(playwright, browser_name).launch(headless=True)
            report["browsers"][browser_name] = browser.version
            for width in WIDTHS:
                for language in ("ja", "en"):
                    for theme in ("light", "dark"):
                        record(matrix_case(browser, browser_name, args.url, width, language, theme, output, counts))
            for result in precedence_cases(browser, browser_name, args.url):
                record(result)
            with local_http() as http_url:
                for width in HTTP_WIDTHS:
                    record(http_case(browser, browser_name, http_url, width, output, counts))
                for width, language, theme in ((320, "ja", "light"), (1280, "en", "dark")):
                    record(startup_case(browser, browser_name, http_url, width, language, theme, output))
            browser.close()
    failed = [item for item in report["cases"] if item["status"] != "passed"]
    report["passed"] = len(report["cases"]) - len(failed)
    report["failed"] = len(failed)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{report['passed']} passed, {report['failed']} failed; {output}", flush=True)
    for item in failed:
        print(item["case"], item.get("error", ""), flush=True)
    return bool(failed)


if __name__ == "__main__":
    raise SystemExit(main())
