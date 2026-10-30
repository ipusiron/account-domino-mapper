"""Browser gates for Account Domino Mapper (Playwright for Python; not part of CI).

Run with a Python environment that already contains Playwright:
    python test/interface.browser.py --stage 1c
    python test/interface.browser.py --stage 1c --output <folder>
    python test/interface.browser.py --stage 1c --url http://127.0.0.1:8000/
A stage also runs the checks of the stages before it (1c runs the 1a and 1b checks too).
Results and viewport screenshots are written to --output (default: a new folder in the
system temporary directory). Nothing is written inside the repository.
"""
import argparse
import base64
import datetime
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
STAGES = ("1a", "1b", "1c")
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
  // The text of each line, measured one character at a time over every text node (recorded to show where a label breaks).
  const lines = el => {
    const rows = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, top = null;
    while ((node = walker.nextNode())) {
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (!rows.length || (rect.height > 0 && Math.abs(rect.top - top) > 2)) { rows.push(''); top = rect.top; }
        rows[rows.length - 1] += node.data[i];
      }
    }
    return rows.length ? rows.map(row => row.trim()) : [el.textContent];
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
    // Every control in the two guarded groups (buttons, the summary of a details box, links, selects, inputs) is disabled
    // or not shown; a disabled fieldset does not stop a summary from opening its details box.
    allDisabled: Array.from(document.querySelectorAll(['#startup-tools', '#startup-controls']
      .map(group => ['button', 'summary', 'a[href]', 'select', 'input'].map(tag => group + ' ' + tag).join(', ')).join(', ')))
      .every(control => control.matches(':disabled') || !control.getClientRects().length),
    fourCards: (box => ({shown: box.getClientRects().length > 0, open: box.open}))(document.querySelector('#four-cards')),
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
# Tries to move the focus to the summary of the four-cards box; true when it took the focus (the focus is then given back).
SUMMARY_FOCUS = """() => { const summary = document.querySelector('#four-cards > summary'); summary.focus();
  const took = document.activeElement === summary; if (took) summary.blur(); return took; }"""
HEADING_LEVELS = """() => Array.from(document.querySelectorAll('h1, h2, h3, h4'), el => Number(el.tagName[1]))"""
# The children of the help's term list in document order: tag, text key and text.
GLOSSARY = """() => Array.from(document.querySelectorAll('#help-terms > *'), el => ({
  tag: el.tagName.toLowerCase(), key: el.dataset.i18n || null, text: el.textContent.trim()}))"""
# The element with the focus inside the help: its id, the lesson of a lesson title, or its class.
HELP_ACTIVE = """() => { const a = document.activeElement;
  return a.id || (a.tagName === 'SUMMARY' ? 'summary:' + a.parentElement.id : a.tagName === 'A' ? 'link:' + a.getAttribute('href') : a.className); }"""
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
    # The diagrams are drawn at their natural size; below 808px a figure may scroll inside itself (never the page).
    unexpected = [box for box in measured["wraps"] if not (box["el"] in ("figure#chain-figure", "figure#after-figure") and width < 808)]
    check(not unexpected, (name, "scrolling boxes", measured["wraps"]))
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
    # The ten lessons are written with the printed sheets right after startup (so the hidden help is in the page's language)
    page.wait_for_selector('#print-sheet[data-ready="true"]', state="attached")
    built = page.evaluate("""() => Array.from(document.querySelectorAll('#lessons > details'),
      d => [d.querySelector(':scope > summary').textContent.length, d.querySelector('.lesson-body').children.length])""")
    check(len(built) == 10 and all(title > 0 and parts > 0 for title, parts in built), ("the lessons are built before the help opens", built))
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
    # The focus order with the ten lessons closed: the close button, the scrollable help text, the ten lesson titles, then back
    active = HELP_ACTIVE
    check(page.evaluate(active) == "close-help", "help opens on the close button")
    page.keyboard.press("Tab")
    check(page.evaluate(active) == "help-body", "Tab reaches the scrollable help text")
    for number in range(1, 11):
        page.keyboard.press("Tab")
        check(page.evaluate(active) == "summary:lesson-" + str(number), ("Tab reaches the title of lesson", number, page.evaluate(active)))
    page.keyboard.press("Tab")
    check(page.evaluate(active) == "close-help", "Tab cycles back to the close button")
    page.keyboard.press("Shift+Tab")
    check(page.evaluate(active) == "summary:lesson-10", "Shift+Tab cycles to the last item")
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


# ===== Stage 1b: tab 1 (follow the chain), tab 2 (lockout), the diagram, playback and the highlights W1, P1, P2, S1-S3 =====
CARDS = ("leak", "simswap", "mail", "desk")
DEFAULT_ACCOUNT = {"worker": "mailMain", "parent": "bank", "student": "sec"}
# The width of each diagram: four columns 704; the parent's three columns 532, so that its vertical lanes keep 4px apart
# while the figure still does not scroll on a 720px screen
MAP_WIDTH = {"worker": 704, "parent": 532, "student": 704}
PLAY_INTERVAL = 900
CELL_FALLEN = {"ja": "●{rank}（{via}）", "en": "●{rank} ({via})"}
CELL_GIVEN = {"ja": "●0（カードで直接）", "en": "●0 (given by the card)"}
CELL_NONE = {"ja": "－", "en": "–"}
CELL_BACKDOOR = {"ja": "裏口", "en": "backdoor"}
CELL_THIS_STEP = {"ja": "いまの段", "en": "this step"}
SUMMARY = {
    "ja": {"many": "このカード1枚で、{n}つのアカウントが倒れます（全{total}のうち、★{imp}）。",
           "one": "このカード1枚で、{n}つのアカウントが倒れます（全{total}のうち、★{imp}）。",
           "many-noimp": "このカード1枚で、{n}つのアカウントが倒れます（全{total}のうち）。",
           "one-noimp": "このカード1枚で、{n}つのアカウントが倒れます（全{total}のうち）。",
           "none": "このカードでは、倒れるアカウントはありません。"},
    "en": {"many": "With this card alone, {n} of {total} accounts fall (★{imp}).",
           "one": "With this card alone, {n} of {total} accounts falls (★{imp}).",
           "many-noimp": "With this card alone, {n} of {total} accounts fall.",
           "one-noimp": "With this card alone, {n} of {total} accounts falls.",
           "none": "No account falls to this card."},
}
IMPORTANT_READ = {"ja": "重要なアカウントは{imp}つ", "en": "{imp} important"}
STEP_ZERO = {"ja": "段0：カードが渡したもの（{gives}）", "en": "Step 0 (given by the card): {gives}"}
STEP_STATUS = {"ja": "段{step}（最後は段{max}）：{accounts}", "en": "Step {step} (last: {max}): {accounts}"}
STATUS_JOIN = {"ja": "{status}。{summary}", "en": "{status}. {summary}"}
LIST_SEPARATOR = {"ja": "・", "en": ", "}
PERSONAL_DETAILS = {"ja": "個人情報", "en": "Personal details"}
MAP_CAPTION = {"ja": "{person}の地図（{card}・段{step}）", "en": "Map: {person} ({card}, step {step})"}
CARD_NAMES = {"ja": {"leak": "漏えい", "simswap": "SIMスワップ", "mail": "メールの乗っ取り", "desk": "窓口のなりすまし"},
              "en": {"leak": "Breach", "simswap": "SIM swap", "mail": "Email takeover", "desk": "Help-desk impersonation"}}
DETAIL_HEADING = {"ja": "{account}の詳しい様子", "en": "{account}: details"}
REDUCED_PLAY = {"ja": "動きを減らす設定のため、最後の段を表示しました。1段ずつ見るときは「最初から」を押してから「次の段 ▶」を押します。",
                "en": "Reduced motion is on, so the last step is shown. To go one step at a time, press “Start over”, then “Next step ▶”."}
# The four-cards table: the headings (short name shown, full name read) and the sentences read for a cell
FOUR_HEADS = {"ja": (("漏えい", "漏えい"), ("SIM", "SIMスワップ"), ("メール", "メールの乗っ取り"), ("窓口", "窓口のなりすまし")),
              "en": (("Breach", "Breach"), ("SIM", "SIM swap"), ("Email", "Email takeover"), ("Desk", "Help-desk impersonation"))}
FOUR_READ = {"ja": {"none": "倒れない", "given": "カードが直接渡した", "falls": "段{rank}で倒れる"},
             "en": {"none": "Does not fall", "given": "Given directly by the card", "falls": "Falls at step {rank}"}}
COL_ACCOUNT = {"ja": "アカウント", "en": "Account"}
# The places where a Japanese tab name may break (between its words); English breaks at a space
TAB_SPLITS = {"連鎖を追う": (("連鎖を追う",), ("連鎖を", "追う")), "閉め出し": (("閉め出し",),),
              "1手で比べる": (("1手で比べる",), ("1手で", "比べる")), "規則表": (("規則表",),)}
# Guide heights of the narrow tables from the layout model behind the spec (tables without a caption, so the table is
# measured without its caption): the map table of the office worker (320px, and 390px in Japanese) and the lockout table
# of the parent (320px). Only these widths and languages have a guide; a table that grows above one fails.
TABLE_LIMITS = {("map", 320, "ja"): 1003, ("map", 320, "en"): 1033, ("map", 390, "ja"): 944,
                ("lock", 320, "ja"): 692, ("lock", 320, "en"): 735}
# Characters that may not start a line (Japanese line-breaking rules); no <wbr> may stand right before one of them. ＋＝／→
# are joined to the character before them too (keep-all does not hold them), so ＋ is never left alone on a line.
NO_LINE_START = "、。，．・：；？！ー）」』】〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ＋＝／→"
CARD_NOTE_START = {"ja": {"leak": "漏えいのカードは", "simswap": "SMSの線は", "desk": "電話の窓口は"},
                   "en": {"leak": "The breach card", "simswap": "An SMS line opens", "desk": "A phone help desk"}}
LOCK_MARKS = {"ja": {"ok": "○", "locked": "×", "gone": "消"}, "en": {"ok": "○", "locked": "×", "gone": "gone"}}
# A "one more loss" cell written out (the cells of tab 2 in the spec: cellPlus1 and cellPlus2). The partners are named by their
# loss card (the email by its short name, in English after "the"); English says "go" when the last partner is the paper codes.
PARTNERS = {"ja": {"device": "スマホ", "number": "番号", "paper": "紙"},
            "en": {"device": "the phone", "number": "the number", "paper": "the paper codes"}}
PLUS_TEXT = {"ja": ("○（＋{p}で×）", "○（＋{p1}か＋{p2}で×）"),
             "en": ("○ (× if {p} {verb} too)", "○ (× if {p1} or {p2} {verb} too)")}
STATUS_HIGHLIGHT = {"ja": "見どころ：{title}", "en": "Highlight: {title}"}
HIGHLIGHT_TITLES = {
    "W1": {"ja": "漏えい1枚で、6つのアカウントが倒れるまで", "en": "One breach, 6 accounts falling"},
    "P1": {"ja": "SIMスワップ1枚で銀行が倒れる", "en": "One SIM swap, and the bank falls"},
    "P2": {"ja": "電話番号を手放すと、銀行に入れない", "en": "Give up the number, and you are locked out of the bank"},
    "S1": {"ja": "ゲームの漏えいから証券まで", "en": "From a game breach to the brokerage"},
    "S2": {"ja": "大学のメールの乗っ取りで、7つすべて", "en": "University email taken over: all 7"},
    "S3": {"ja": "卒業で、動画のサブスクに入れない", "en": "Graduation locks you out of the video subscription"},
}
# The highlights measured in stage 1b: id, person, position among the person's three, focus target.
HIGHLIGHTS_1B = (("W1", "worker", 0, "#step-next"), ("P1", "parent", 0, "#detail-heading"),
                 ("P2", "parent", 1, '[data-key="lock-acct:bank"]'), ("S1", "student", 0, "#step-next"),
                 ("S2", "student", 1, "#detail-heading"), ("S3", "student", 2, '[data-key="lock-acct:sub"]'))
# The mark of an opened entrance in the diagram, and the sentences of the detail panel (the screen text table of the spec).
OPEN_TAG = {"ja": "開", "en": "open"}
DETAIL_FALLS = {"ja": "このカードでは：段{rank}で倒れる（開けた入口：{via}）",
                "en": "With this card: falls at step {rank} (entrance used: {via})"}
SR_BACKDOOR = {"ja": "裏口（復旧の入口がなければ、このカードでは倒れなかった）",
               "en": "Backdoor (would not fall to this card without the recovery entrances)"}
NEED = {"ja": {"all": "倒すのに要るカード：4枚のどれでも1枚で倒れる", "one": "倒すのに要るカード：{card}1枚",
               "any": "倒すのに要るカード：どれか1枚（{cards}）"},
        "en": {"all": "Cards needed: any one of the four cards is enough", "one": "Cards needed: {card} alone",
               "any": "Cards needed: any one of {cards}"}}
NOTE_BROKERAGE = {
    "ja": "架空のネット証券は、ログインにパスキーが必須です。倒れるのは、パスキーを再登録する復旧の線からだけです（端末の感染は模型の外）。",
    "en": "The fictional brokerage requires a passkey to log in; it falls only through the recovery line "
          "that re-registers the passkey (an infected device is outside the model).",
}
NOTE_BROKERAGE_STUDENT = {
    "ja": "ミオの再登録を登録メールだけにしたのは教材のための設定で、各社の公開FAQで見た代わりの線（パスワード＋SMSの認証など）より弱くしてあります。",
    "en": "Mio's passkey re-registration by registered email alone is a setting chosen for teaching; it is weaker than "
          "the fallback lines seen in brokerages' public FAQs (such as password plus SMS).",
}
VISIBLE = """el => { if (!el) return null; const c = el.cloneNode(true);
  c.querySelectorAll('.visually-hidden').forEach(n => n.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); }"""
CHAIN_STATE = """() => {
  const visible = """ + VISIBLE + """;
  const rows = Array.from(document.querySelectorAll('#chain-map tbody tr'), tr => {
    const button = tr.querySelector('th button'), cells = tr.querySelectorAll('td'), result = cells[cells.length - 1];
    return {id: button.dataset.key.slice('chain-acct:'.length), pressed: button.getAttribute('aria-pressed'),
      tabindex: button.getAttribute('tabindex'), cell: visible(result),
      sr: Array.from(result.querySelectorAll('.visually-hidden'), n => n.textContent).join(' '),
      thisStep: tr.classList.contains('this-step'), selected: tr.classList.contains('selected')};
  });
  const button = id => { const b = document.querySelector('#step-' + id);
    return {disabled: b.getAttribute('aria-disabled'), pressed: b.getAttribute('aria-pressed'), text: b.textContent,
      tabindex: b.getAttribute('tabindex')}; };
  const note = document.querySelector('#card-note'), line = document.querySelector('#step-line');
  return {caption: document.querySelector('#chain-map caption').textContent, rows,
    line: visible(line), lineShown: line.getClientRects().length > 0,
    lineLive: [line.getAttribute('role'), line.getAttribute('aria-live'), line.closest('[aria-live]') ? 'inside a live region' : null],
    summary: visible(document.querySelector('#step-summary')), status: document.querySelector('#step-status').textContent,
    detail: document.querySelector('#detail-heading').textContent, detailBody: visible(document.querySelector('#detail-body')),
    startHere: document.querySelector('#start-here').getClientRects().length > 0,
    story: document.querySelector('#story').textContent, cardLine: document.querySelector('#card-line').textContent,
    cards: Object.fromEntries(Array.from(document.querySelectorAll('.card-buttons button'),
      b => [b.dataset.key.slice(5), b.getAttribute('aria-pressed')])),
    steps: {first: button('first'), next: button('next'), last: button('last'), play: button('play')},
    note: note.hidden ? null : note.textContent,
    highlights: Array.from(document.querySelectorAll('#highlights button'), b => b.dataset.key.slice(3)),
    startTag: Array.from(document.querySelectorAll('#highlights .start-tag'), s => s.textContent),
    figureVisible: document.querySelector('#chain-figure').getClientRects().length > 0,
    svgVisible: (s => !!s && s.getClientRects().length > 0)(document.querySelector('#chain-figure svg'))};
}"""
SHAPES = """() => {
  const shown = el => el.getClientRects().length > 0;
  const heads = selector => Array.from(document.querySelectorAll(selector + ' thead th')).filter(shown).length;
  return {map: heads('#chain-map'), mapInline: Array.from(document.querySelectorAll('#chain-map .entrances-inline')).every(shown),
    mapCells: Array.from(document.querySelectorAll('#chain-map .entrances-cell')).some(shown),
    four: heads('#four-cards-table'), lock: heads('#lock-map')};
}"""
# The diagram in a figure (tab 1: #chain-figure; tab 3: #after-figure, inside the box of the map after a change). frame is
# the horizontal padding, border and margin of the figure and of the boxes around it inside the panel.
SVG_METRICS = """(sel = '#chain-figure') => {
  const figure = document.querySelector(sel), svg = figure.querySelector('svg');
  const px = v => parseFloat(v) || 0;
  let frame = 0;
  for (let el = figure; el && !el.classList.contains('panel'); el = el.parentElement) {
    const css = getComputedStyle(el);
    frame += px(css.paddingLeft) + px(css.paddingRight) + px(css.borderLeftWidth) + px(css.borderRightWidth)
      + px(css.marginLeft) + px(css.marginRight);
  }
  const texts = Array.from(svg.querySelectorAll('text'));
  const union = boxes => { const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    return {x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y}; };
  const inside = (b, r) => b.x >= r.x - 0.5 && b.y >= r.y - 0.5 && b.x + b.width <= r.x + r.width + 0.5
    && b.y + b.height <= r.y + r.height + 0.5;
  const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
  const plain = b => ({x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
    width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10});
  const problems = [];
  for (const item of svg.querySelectorAll('.map-item')) {
    const node = item.dataset.node, rect = item.querySelector(':scope > rect').getBBox();
    const labels = [];
    const own = Array.from(item.querySelectorAll(':scope > text'));
    if (own.length) labels.push({name: node, box: union(own.map(t => t.getBBox()))});
    for (const row of item.querySelectorAll('.map-row')) {
      labels.push({name: row.dataset.row, box: union(Array.from(row.querySelectorAll('text'), t => t.getBBox()))});
    }
    for (const mark of svg.querySelectorAll('.map-mark')) {
      const owner = mark.dataset.node || (mark.dataset.row || '').split('.')[0];
      if (owner === node) labels.push({name: 'mark ' + (mark.dataset.node || mark.dataset.row), box: mark.getBBox()});
    }
    // tab 3: the "changed" line under a changed entrance
    for (const change of item.querySelectorAll('.map-change')) {
      labels.push({name: 'changed ' + change.dataset.row, box: change.querySelector('text').getBBox()});
    }
    for (const label of labels) if (!inside(label.box, rect)) problems.push({outside: label.name, box: plain(label.box), rect: plain(rect)});
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      if (overlap(labels[i].box, labels[j].box)) problems.push({overlap: [labels[i].name, labels[j].name]});
    }
  }
  return {viewBox: svg.viewBox.baseVal.width, viewBoxHeight: svg.viewBox.baseVal.height,
    width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height,
    sizes: Array.from(new Set(texts.map(t => getComputedStyle(t).fontSize))), texts: texts.length, frame,
    scroll: figure.scrollWidth, client: figure.clientWidth, problems,
    title: svg.querySelector('title').textContent, desc: svg.querySelector('desc').textContent,
    labelledby: svg.getAttribute('aria-labelledby'), role: svg.getAttribute('role'),
    lines: svg.querySelectorAll('.map-line').length, hot: svg.querySelectorAll('.map-line.hot').length,
    fallen: svg.querySelectorAll('.fallen').length, open: svg.querySelectorAll('.map-open').length};
}"""
LOCK_STATE = """() => {
  const visible = """ + VISIBLE + """;
  return {caption: document.querySelector('#lock-map caption').textContent,
    legend: document.querySelector('#lock-legend-mail').textContent,
    rows: Array.from(document.querySelectorAll('#lock-map tbody tr'), tr => {
      const button = tr.querySelector('th button');
      return {id: button.dataset.key.slice('lock-acct:'.length), pressed: button.getAttribute('aria-pressed'),
        tabindex: button.getAttribute('tabindex'),
        cells: Array.from(tr.querySelectorAll('td'), td => ({text: visible(td),
          sr: Array.from(td.querySelectorAll('.visually-hidden'), n => n.textContent).join(' '),
          locked: (m => m ? {weight: getComputedStyle(m).fontWeight, size: parseFloat(getComputedStyle(m).fontSize),
            cell: parseFloat(getComputedStyle(td).fontSize)} : null)(td.querySelector('.mark-locked'))}))};
    }),
    notes: Array.from(document.querySelectorAll('#panel-lockout .note-list li')).filter(li => li.getClientRects().length).length};
}"""
# The state the diagram shows for one step (what is fallen, which entrances are open, which lines are thick, title and desc).
SVG_STATE = """(sel = '#chain-figure') => {
  const svg = document.querySelector(sel + ' svg');
  return {fallen: Array.from(svg.querySelectorAll('.map-item'))
      .filter(g => g.querySelector('.map-box, .map-card').classList.contains('fallen')).map(g => g.dataset.node).sort(),
    marks: Object.fromEntries(Array.from(svg.querySelectorAll('.map-mark[data-node]'), m => [m.dataset.node, m.textContent])),
    open: Array.from(svg.querySelectorAll('.map-open'), m => [m.dataset.row, m.textContent]),
    hot: Array.from(new Set(Array.from(svg.querySelectorAll('.map-line.hot'), l => l.dataset.to))).sort(),
    hotLines: svg.querySelectorAll('.map-line.hot').length,
    title: svg.querySelector(':scope > title').textContent, desc: svg.querySelector(':scope > desc').textContent};
}"""
# The paragraphs of the detail panel, in order.
DETAIL_TEXTS = "() => Array.from(document.querySelectorAll('#detail-body p'), p => p.textContent)"
# Records every CSS transition that starts in the diagram from now on (transitionrun), so that a check can say which
# transitions ran without reading the running animations at one instant: the node of a box or card, or the line, and the
# property.
TRANSITION_RECORDER = """() => {
  const figure = document.querySelector('#chain-figure');
  if (window.__qaRunsListener) figure.removeEventListener('transitionrun', window.__qaRunsListener);
  window.__qaRuns = [];
  window.__qaRunsListener = event => {
    const target = event.target, item = target.closest('.map-item');
    window.__qaRuns.push([item ? 'node ' + item.dataset.node : 'line ' + target.dataset.from + '->' + target.dataset.to,
      event.propertyName]);
  };
  figure.addEventListener('transitionrun', window.__qaRunsListener);
}"""
# The transition declared for the borders and lines of the diagram (none with reduced motion).
TRANSITION_STYLE = """() => Array.from(new Set(Array.from(document.querySelectorAll('#chain-figure .map-card, #chain-figure .map-box,'
  + ' #chain-figure .map-line'), el => getComputedStyle(el).transitionDuration)))"""
# Resolves after n animation frames of the page (real frames; used where no page clock is installed).
FRAMES = "(n) => new Promise(resolve => { const next = i => (i ? requestAnimationFrame(() => next(i - 1)) : resolve()); next(n); })"
# The colors the diagram of tab 1 is drawn with, as computed (whichever rule of style.css wins): each distinct stroke of the
# plain and thick lines and of the borders of the standing and fallen boxes and cards, each distinct fill of its text and of
# its boxes and cards, the paper of the figure; and the focus ring of the element with the focus, with the panel under it
# and the ground of the page.
DIAGRAM_COLORS = """() => {
  const figure = document.querySelector('#chain-figure'), svg = figure.querySelector('svg');
  const all = (sel, prop) => Array.from(new Set(Array.from(svg.querySelectorAll(sel), el => getComputedStyle(el)[prop])));
  const active = document.activeElement, ring = getComputedStyle(active);
  return {paper: getComputedStyle(figure).backgroundColor, fills: all('.map-box, .map-card', 'fill'),
    parts: {line: all('.map-line:not(.hot)', 'stroke'), hot: all('.map-line.hot', 'stroke'),
      border: all('.map-box:not(.fallen), .map-card:not(.fallen)', 'stroke'), fallen: all('.map-box.fallen, .map-card.fallen', 'stroke')},
    text: all('text', 'fill'),
    focus: {id: active.id, visible: active.matches(':focus-visible'), style: ring.outlineStyle, color: ring.outlineColor,
      panel: getComputedStyle(active.closest('.panel') || document.body).backgroundColor,
      ground: getComputedStyle(document.body).backgroundColor}};
}"""
# The four-cards table: headings (text shown and read) and, per row, the account shown and each cell shown and read.
FOUR_CELLS = """() => {
  const visible = """ + VISIBLE + """;
  const read = el => Array.from(el.querySelectorAll('.visually-hidden'), n => n.textContent).join(' ');
  const table = document.querySelector('#four-cards-table table');
  return {heads: Array.from(table.querySelectorAll('thead th'), th => [visible(th), read(th)]),
    rows: Array.from(table.querySelectorAll('tbody tr'), tr => ({name: visible(tr.querySelector('th')),
      cells: Array.from(tr.querySelectorAll('td'), td => [visible(td), read(td)])}))};
}"""
# Each tab: its text, the lines it shows (characters grouped by their line) and the position of the tab.
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
  const box = tab.getBoundingClientRect();
  return {id: tab.id, text: tab.textContent, lines: lines.map(s => s.trim()), top: Math.round(box.top), left: Math.round(box.left)};
})"""
# A narrow table: heights (with and without the caption), widths, the shown columns, the smallest font and every line break
# that splits a word within one text box. A line may break at a space, at a <wbr>, after 、。・：＋＝／→）」,.;:)-/ or before an
# opening bracket; any other break splits a word (a word and its particle, ★ and the name, a comma that starts a line), and
# so does a break between two Latin letters or digits, two katakana or two kanji, even at a <wbr>.
# For the lockout table, also the width it takes when no word may be split (its .break-words class taken off for a moment).
NARROW_TABLE = """(sel) => {
  const frame = document.querySelector(sel), table = frame.querySelector('table');
  const BOX = 'caption, th, td, button, li, .backdoor-label, .this-step-label';
  const AFTER = '、。・：＋＝／→）」,.;:)-/', BEFORE = '（(「『';
  const kind = ch => {
    if (/[A-Za-z0-9]/.test(ch)) return 'latin';
    if (ch === '・') return 'other';
    const c = ch.codePointAt(0);
    if (c >= 0x30A0 && c <= 0x30FF) return 'katakana';
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) return 'kanji';
    return 'other';
  };
  const split = [];
  for (const box of Array.from(table.querySelectorAll(BOX)).filter(el => el.getClientRects().length)) {
    // The characters of the box in order, each with its line (top) and whether a <wbr> stands before it
    const chars = [];
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node, wbr = false;
    while ((node = walker.nextNode())) {
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      if (element.closest('.visually-hidden') || element.closest(BOX) !== box) continue;
      if (node.nodeType !== Node.TEXT_NODE) { if (node.tagName === 'WBR') wbr = true; continue; }
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        const shown = !!rect && rect.width > 0;
        chars.push({ch: node.data[i], top: shown ? rect.top : null, wbr: shown && wbr});
        if (shown) wbr = false;
      }
    }
    let top = null, previous = null, between = '', line = '';
    for (const c of chars) {
      if (c.top === null) { between += c.ch; continue; }
      if (top !== null && Math.abs(c.top - top) > 3 && !/\\s/.test(between + previous.ch + c.ch)) {
        const a = kind(previous.ch), b = kind(c.ch);
        const allowed = c.wbr || AFTER.includes(previous.ch) || BEFORE.includes(c.ch);
        if ((a === b && a !== 'other') || !allowed) split.push(line.slice(-4) + '|' + c.ch);
      }
      if (top === null || Math.abs(c.top - top) > 3) { top = c.top; line = ''; }
      line += between + c.ch; between = ''; previous = c;
    }
  }
  const height = el => el ? el.getBoundingClientRect().height : 0;
  const fonts = Array.from(table.querySelectorAll('caption, th, td, button, li, span'))
    .filter(el => el.getClientRects().length && !el.closest('.visually-hidden') && el.textContent.trim())
    .map(el => parseFloat(getComputedStyle(el).fontSize));
  const breakWords = table.classList.contains('break-words');
  let wholeWidth = null;
  if (breakWords) {
    table.classList.remove('break-words');
    wholeWidth = table.getBoundingClientRect().width;
    table.classList.add('break-words');
  }
  const round = n => Math.round(n * 10) / 10;
  return {height: round(height(table)), body: round(height(table) - height(table.querySelector('caption'))),
    width: round(table.getBoundingClientRect().width), frame: round(frame.getBoundingClientRect().width),
    columns: Array.from(table.querySelectorAll('thead th')).filter(th => th.getClientRects().length).length,
    minFont: Math.min(...fonts), split, breakWords, wholeWidth: wholeWidth === null ? null : round(wholeWidth)};
}"""
# Every <wbr> on the page, with the text before it and the character after it
WBR_NEXT = """() => Array.from(document.querySelectorAll('wbr'), w => {
  const text = n => (n && n.nodeType === Node.TEXT_NODE ? n.data : '');
  return [text(w.previousSibling).slice(-4), text(w.nextSibling).slice(0, 1)];
})"""
# The line breaks that split a word inside the boxes of each selector, by the rules of NARROW_TABLE (a line may break at a
# space, at a <wbr>, after 、。・：＋＝／→）」,.;:)-/ or before an opening bracket); text read aloud only is skipped. Lines are
# followed inside the box that lays them out (the nearest ancestor that is not inline: a list item, a span shown as a block,
# a label drawn inline-block), so the start of the next item is not taken for a break.
TEXT_SPLITS = """(selectors) => {
  const AFTER = '、。・：＋＝／→）」,.;:)-/', BEFORE = '（(「『';
  const kind = ch => {
    if (/[A-Za-z0-9]/.test(ch)) return 'latin';
    if (ch === '・') return 'other';
    const c = ch.codePointAt(0);
    if (c >= 0x30A0 && c <= 0x30FF) return 'katakana';
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) return 'kanji';
    return 'other';
  };
  const lineBox = (el, root) => {
    for (; el && el !== root; el = el.parentElement) {
      const display = getComputedStyle(el).display;
      if (display !== 'inline' && display !== 'contents') return el;
    }
    return root;
  };
  const out = {};
  for (const sel of selectors) {
    const split = [];
    for (const root of Array.from(document.querySelectorAll(sel)).filter(el => el.getClientRects().length)) {
      const groups = new Map(), pending = new Set();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (element.closest('.visually-hidden')) continue;
        if (node.nodeType !== Node.TEXT_NODE) { if (node.tagName === 'WBR') pending.add(lineBox(node.parentElement, root)); continue; }
        const box = lineBox(node.parentElement, root);
        if (!groups.has(box)) groups.set(box, []);
        for (let i = 0; i < node.length; i++) {
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          const shown = !!rect && rect.width > 0;
          groups.get(box).push({ch: node.data[i], top: shown ? rect.top : null, wbr: shown && pending.has(box)});
          if (shown) pending.delete(box);
        }
      }
      for (const chars of groups.values()) {
        let top = null, previous = null, between = '', line = '';
        for (const c of chars) {
          if (c.top === null) { between += c.ch; continue; }
          if (top !== null && Math.abs(c.top - top) > 3 && !/\\s/.test(between + previous.ch + c.ch)) {
            const a = kind(previous.ch), b = kind(c.ch);
            const allowed = c.wbr || AFTER.includes(previous.ch) || BEFORE.includes(c.ch);
            if ((a === b && a !== 'other') || !allowed) split.push(line.slice(-4) + '|' + c.ch);
          }
          if (top === null || Math.abs(c.top - top) > 3) { top = c.top; line = ''; }
          line += between + c.ch; between = ''; previous = c;
        }
      }
    }
    out[sel] = split;
  }
  return out;
}"""
# The lines of the visible text of every box of a selector (characters grouped by their line)
BOX_LINES = """(sel) => Array.from(document.querySelectorAll(sel)).filter(el => el.getClientRects().length).map(el => {
  const chars = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) { if (node.parentElement.closest('.visually-hidden')) continue;
    for (let i = 0; i < node.length; i++) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
      const rect = r.getClientRects()[0]; if (rect && rect.width > 0) chars.push([node.data[i], rect.top]); } }
  const out = []; let top = null;
  for (const [ch, t] of chars) { if (top === null || Math.abs(t - top) > 3) { out.push(''); top = t; } out[out.length - 1] += ch; }
  return out.map(s => s.trim());
})"""
# How the cells of the lockout table split a word when whole words do not fit: the hyphenation of an English cell and the
# fallback class
LOCK_HYPHENS = """() => { const table = document.querySelector('#lock-map table'), cs = getComputedStyle(table.querySelector('td'));
  return {hyphens: cs.hyphens || cs.webkitHyphens, character: cs.hyphenateCharacter || cs.webkitHyphenateCharacter || '',
    wrap: cs.overflowWrap, anywhere: table.classList.contains('break-anywhere')}; }"""
# Turns English hyphenation off in the lockout table (as in a browser without the dictionary), or back on; then the page's
# resize handler fits the table again
NO_HYPHENS = """off => {
  if (off) { const sheet = new CSSStyleSheet();
    sheet.replaceSync('.lock-table th, .lock-table td, .lock-table .name-button { -webkit-hyphens: manual !important; hyphens: manual !important; }');
    window.__qaNoHyphens = sheet; document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }
  else document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.__qaNoHyphens);
  window.dispatchEvent(new Event('resize'));
}"""
# The lines of the visible text of each heading and row name in the four-cards table (characters grouped by their line).
FOUR_LINES = """() => {
  const lines = el => { const chars = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { if (node.parentElement.closest('.visually-hidden')) continue;
      for (let i = 0; i < node.length; i++) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
        const rect = r.getClientRects()[0]; if (rect) chars.push([node.data[i], rect.top]); } }
    const out = []; let top = null;
    for (const [ch, t] of chars) { if (top === null || Math.abs(t - top) > 3) { out.push(''); top = t; } out[out.length - 1] += ch; }
    return out; };
  const table = document.querySelector('#four-cards-table table');
  return {heads: Array.from(table.querySelectorAll('thead th'), lines), rows: Array.from(table.querySelectorAll('tbody th'), lines)};
}"""
ACTIVE = "() => { const a = document.activeElement; return {id: a.id, key: (a.dataset || {}).key || null, tag: a.tagName}; }"
IN_VIEW = """el => { const r = el.getBoundingClientRect();
  return {top: r.top, bottom: r.bottom, height: innerHeight, inside: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.height > 0}; }"""
ORDER = """([a, b]) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)"""


def strip_suffix(label):
    return re.sub(r"\s*[（(][^（）()]*[）)]$", "", label)


def load_known():
    """The people, their accounts and the known vectors, read directly from the test data."""
    sample = json.loads((ROOT / "test" / "sample.json").read_text(encoding="utf-8"))
    vectors = json.loads((ROOT / "test" / "vectors.json").read_text(encoding="utf-8"))
    known = {}
    for person in sample["personas"]:
        known[person["id"]] = {
            "person": person, "vectors": vectors["personas"][person["id"]],
            "methods": {s["id"] + "." + m["id"]: m for s in person["services"] for m in s["methods"]},
            "services": [s["id"] for s in person["services"]],
            "important": {s["id"] for s in person["services"] if s.get("important")},
            "full": {lang: {s["id"]: s["label"][lang] for s in person["services"]} for lang in ("ja", "en")},
            "short": {lang: {s["id"]: strip_suffix(s["label"][lang]) for s in person["services"]} for lang in ("ja", "en")},
        }
    return known


def last_step(k, card):
    return max(k["vectors"]["cards"][card]["rank"].values(), default=0)


def expected_cell(k, card, account, step, language):
    result = k["vectors"]["cards"][card]
    rank = result["rank"].get(account)
    if rank is None or rank > step:
        return CELL_NONE[language]
    if rank == 0:
        text = CELL_GIVEN[language]
    else:
        text = CELL_FALLEN[language].format(rank=rank, via=k["methods"][result["via"][account]]["label"][language])
    if account in result["backdoor"]:
        text += CELL_BACKDOOR[language]
    if rank == step:
        text += CELL_THIS_STEP[language]
    return text


def expected_summary(k, card, language):
    fallen = k["vectors"]["cards"][card]["services"]
    imp = len([s for s in fallen if s in k["important"]])
    if not fallen:
        return SUMMARY[language]["none"]
    key = ("one" if len(fallen) == 1 else "many") + ("" if imp else "-noimp")
    return SUMMARY[language][key].format(n=len(fallen), total=len(k["services"]), imp=imp)


def readable(text, language):
    return re.sub(r"★(\d+)", lambda m: IMPORTANT_READ[language].format(imp=m.group(1)), text)


def expected_line(k, card, step, language):
    """The sentence of the step shown under the step buttons: what the card gives (step 0) or what falls at the step."""
    result = k["vectors"]["cards"][card]
    if step == 0:
        names = []
        for node in result["gives"]:
            credential = next((c for c in k["person"]["credentials"] if c["id"] == node), None)
            if credential is None:
                names.append(k["short"][language][node])
            else:
                names.append(PERSONAL_DETAILS[language] if credential["type"] == "info" else credential["label"][language])
        return STEP_ZERO[language].format(gives=LIST_SEPARATOR[language].join(names))
    accounts = [k["short"][language][s] for s in k["services"] if result["rank"].get(s) == step]
    return STEP_STATUS[language].format(step=step, max=last_step(k, card), accounts=LIST_SEPARATOR[language].join(accounts))


def expected_status(k, card, step, language):
    """The sentence written to the live region: the step line, followed by the summary at the last step."""
    status = expected_line(k, card, step, language)
    if step >= last_step(k, card):
        status = STATUS_JOIN[language].format(status=status, summary=expected_summary(k, card, language))
    return readable(status, language)


def expected_desc(k, card, step, language):
    """The desc of the diagram: the sentence of the step followed by the summary (the last step already has it)."""
    text = expected_status(k, card, step, language)
    if step < last_step(k, card):
        text = readable(STATUS_JOIN[language].format(status=text, summary=expected_summary(k, card, language)), language)
    return text


def caption_of(pid, card, step, language):
    return MAP_CAPTION[language].format(person=PERSON_LABELS[language][PEOPLE.index(pid)], card=CARD_NAMES[language][card], step=step)


def assert_svg_state(page, k, pid, card, step, language, name, figure="#chain-figure"):
    """The diagram follows the step: fallen boxes and cards (●step), open entrances and the thick lines into them, title, desc."""
    state = page.evaluate(SVG_STATE, figure)
    result = k["vectors"]["cards"][card]
    fallen = {node: rank for node, rank in result["rank"].items() if rank <= step}
    opened = sorted(result["via"][node] for node in result["via"] if result["rank"][node] <= step)
    check(state["fallen"] == sorted(fallen), (name, "fallen boxes and cards", state["fallen"], sorted(fallen)))
    check(state["marks"] == {node: "●" + str(rank) for node, rank in fallen.items()}, (name, "step marks", state["marks"]))
    check(sorted(row for row, _ in state["open"]) == opened, (name, "open entrances", state["open"], opened))
    check(all(text == OPEN_TAG[language] for _, text in state["open"]), (name, "open mark", state["open"]))
    check(state["hot"] == opened, (name, "thick lines go into the open entrances", state["hot"], opened))
    check(state["hotLines"] == sum(len(k["methods"][row]["requires"]) for row in opened), (name, "every line into them is thick"))
    check(state["title"] == caption_of(pid, card, step, language), (name, "svg title", state["title"]))
    check(state["desc"] == expected_desc(k, card, step, language), (name, "svg desc", state["desc"]))


def contrast(color, ground):
    """The WCAG 2 contrast ratio of a computed color ("rgb(...)" or "rgba(...)") against an opaque ground; a translucent color
    is laid over the ground first. Anything else (none, a url) is not a color and fails."""
    def channels(value):
        numbers = [float(x) for x in re.findall(r"[\d.]+", value)]
        check(re.match(r"rgba?\(", value) and len(numbers) in (3, 4), ("not a color", value))
        return numbers[:3], numbers[3] if len(numbers) == 4 else 1.0

    def luminance(rgb):
        c = [x / 255 for x in rgb]
        c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    (front, alpha), (back, opaque) = channels(color), channels(ground)
    check(opaque == 1, ("the ground is not opaque", ground))
    mixed = [alpha * f + (1 - alpha) * b for f, b in zip(front, back)]
    lighter, darker = sorted((luminance(mixed), luminance(back)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def assert_diagram_colors(page, name, results):
    """The colors of the spec's color table as the browser draws them, in the theme of the page (a later rule of style.css
    that overrides one is seen too): the plain and thick lines and the borders of standing and fallen boxes and cards at
    least 3:1 against the paper of the figure and the fill of the boxes and cards, the text of the diagram at least 4.5:1, and
    the focus ring of Next step at least 3:1 against the panel under it and the ground of the page. Measured where boxes and
    cards have fallen and lines are thick (a step of 1 or more)."""
    # The focus comes back to Next step by the keyboard, so that its ring is shown (:focus-visible) in both browsers
    page.locator("#step-next").focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    colors = page.evaluate(DIAGRAM_COLORS)
    grounds = [colors["paper"], *colors["fills"]]
    for part, values in [*colors["parts"].items(), ("text", colors["text"])]:
        least = 4.5 if part == "text" else 3
        check(values, (name, "the diagram draws", part))
        for value in values:
            ratios = [round(contrast(value, ground), 2) for ground in grounds]
            check(min(ratios) >= least, (name, part, f"at least {least}:1 against the paper and the fills", value, grounds, ratios))
    focus = colors["focus"]
    check(focus["id"] == "step-next" and focus["visible"] and focus["style"] != "none", (name, "the focus ring is shown", focus))
    ratios = [round(contrast(focus["color"], focus[ground]), 2) for ground in ("panel", "ground")]
    check(min(ratios) >= 3, (name, "the focus ring at least 3:1 against the panel and the ground", focus, ratios))
    results.append({"state": name + "-colors", "colors": colors})


def assert_four_cells(page, k, pid, language):
    """Every cell of the four-cards table: ●step or – shown, and the sentence read, from the ranks of the known vectors
    (the table shows the last step whatever the step buttons say)."""
    four = page.evaluate(FOUR_CELLS)
    check(four["heads"] == [[COL_ACCOUNT[language], ""]] + [list(head) for head in FOUR_HEADS[language]],
          (pid, "four-cards headings", four["heads"]))
    check([row["name"] for row in four["rows"]] == [k["short"][language][s] for s in k["services"]],
          (pid, "four-cards rows", [row["name"] for row in four["rows"]]))
    for row, account in zip(four["rows"], k["services"]):
        for (shown, read), card in zip(row["cells"], CARDS):
            rank = k["vectors"]["cards"][card]["rank"].get(account)
            if rank is None:
                expected = [CELL_NONE[language], FOUR_READ[language]["none"]]
            else:
                expected = ["●" + str(rank), FOUR_READ[language]["given" if rank == 0 else "falls"].format(rank=rank)]
            check([shown, read] == expected, (pid, "four-cards cell", account, card, [shown, read], expected))
        check(len(row["cells"]) == 4, (pid, account, "four cells"))


def expected_need(k, account, language):
    """Cards needed (cardBase of the known vectors), for an account that one card alone is enough to bring down."""
    bases = k["vectors"]["cardBase"][account]
    check(bases and all(len(b) == 1 for b in bases), ("single cards only", account, bases))
    names = [CARD_NAMES[language][b[0]] for b in bases]
    if len(names) == len(CARDS):
        return NEED[language]["all"]
    if len(names) == 1:
        return NEED[language]["one"].format(card=names[0])
    cards = "・".join(names) if language == "ja" else ", ".join(names[:-1]) + " or " + names[-1]
    return NEED[language]["any"].format(cards=cards)


def expected_detail(k, card, account, language):
    """The paragraphs of the detail panel: falls (at the last step), the backdoor line, cards needed, the brokerage notes."""
    result = k["vectors"]["cards"][card]
    texts = [DETAIL_FALLS[language].format(rank=result["rank"][account],
                                           via=k["methods"][result["via"][account]]["label"][language])]
    if account in result["backdoor"]:
        texts.append(SR_BACKDOOR[language])
    texts.append(expected_need(k, account, language))
    if account == "sec":
        texts.append(NOTE_BROKERAGE[language])
        if k["person"]["id"] == "student":
            texts.append(NOTE_BROKERAGE_STUDENT[language])
    return texts


def press(page, selector):
    """Press a button with the keyboard (a button at the edge has aria-disabled and does nothing when pressed)."""
    page.locator(selector).focus()
    page.keyboard.press("Enter")


def assert_chain(page, k, pid, card, step, language, name):
    """Tab 1 for one person, card and step: the table cells, the caption, the summary, the step buttons and the detail."""
    state = page.evaluate(CHAIN_STATE)
    check(state["cards"] == {c: str(c == card).lower() for c in CARDS}, (name, "card buttons", state["cards"]))
    caption = MAP_CAPTION[language].format(person=PERSON_LABELS[language][PEOPLE.index(pid)],
                                           card=CARD_NAMES[language][card], step=step)
    check(state["caption"] == caption, (name, "caption", state["caption"], caption))
    check([row["id"] for row in state["rows"]] == k["services"], (name, "rows", [row["id"] for row in state["rows"]]))
    for row in state["rows"]:
        expected = expected_cell(k, card, row["id"], step, language)
        check(row["cell"] == expected, (name, row["id"], row["cell"], expected))
        check(row["thisStep"] == (k["vectors"]["cards"][card]["rank"].get(row["id"]) == step), (name, "this step", row))
        check(bool(row["sr"]), (name, "a sentence is read for the symbol", row))
        check(row["tabindex"] is None, (name, "name buttons stay in the Tab order", row))
    check(state["summary"] == expected_summary(k, card, language), (name, "summary", state["summary"]))
    # The step line is always shown and follows the step; it is not a live region (the live region is #step-status)
    check(state["lineShown"] and state["line"] == expected_line(k, card, step, language), (name, "step line", state["line"]))
    check(state["lineLive"] == [None, None, None], (name, "the step line is not a live region", state["lineLive"]))
    last = last_step(k, card)
    check(state["steps"]["first"]["disabled"] == ("true" if step == 0 else None), (name, "first", state["steps"]))
    for key in ("next", "last"):
        check(state["steps"][key]["disabled"] == ("true" if step >= last else None), (name, key, state["steps"]))
        check(state["steps"][key]["tabindex"] is None, (name, "step buttons stay in the Tab order", key))
    check(state["detail"] and state["detailBody"], (name, "the detail is filled"))
    check(state["startHere"] == (pid == "worker"), (name, "start here only for the office worker"))
    check(state["startTag"] == (["はじめに" if language == "ja" else "Start here"] if pid == "worker" else []), (name, state["startTag"]))
    check(len(state["highlights"]) == 3 and all(h.startswith(pid[0].upper()) for h in state["highlights"]), (name, state["highlights"]))
    note = CARD_NOTE_START[language].get(card)
    check((state["note"] or "").startswith(note) if note else state["note"] is None, (name, "card note", state["note"]))
    return state


def assert_svg(page, width, pid, name, results, figure="#chain-figure"):
    metrics = page.evaluate(SVG_METRICS, figure)
    check(abs(metrics["width"] - metrics["viewBox"]) <= 0.5, (name, "the diagram is not scaled", metrics["width"], metrics["viewBox"]))
    check(metrics["viewBox"] == MAP_WIDTH[pid], (name, "viewBox width", metrics["viewBox"]))
    check(metrics["sizes"] == ["14px"], (name, "text size", metrics["sizes"]))
    check(not metrics["problems"], (name, "labels", metrics["problems"][:6]))
    check(metrics["role"] == "img" and metrics["title"] and metrics["desc"], (name, "named image", metrics["title"], metrics["desc"]))
    if width >= 808 or pid == "parent":
        # The parent's diagram (532 wide) fits a 720px screen too
        check(metrics["scroll"] <= metrics["client"], (name, "the figure does not scroll", metrics["scroll"], metrics["client"]))
    if width >= 808:
        check(metrics["frame"] <= 30, (name, "figure padding, border and margin", metrics["frame"]))
    results.append({"state": name, "svg": {key: value for key, value in metrics.items() if key != "problems"}})
    return metrics


def test_chain_tab(page, width, layouts, language, known):
    """Every person and card at the last step (and the diagram on wide screens), steps, reduced-motion playback, notes."""
    page.locator("#tab-chain").click()
    for pid in PEOPLE:
        k = known[pid]
        page.locator("#person-" + pid).click()
        for card in CARDS:
            page.locator("#card-" + card).click()
            name = f"{pid}-{card}-last"
            state = assert_chain(page, k, pid, card, last_step(k, card), language, name)
            check(state["svgVisible"] == (width >= 720), (name, "the diagram shows only on wide screens"))
            check(page.locator("#chain-map table").is_visible(), (name, "the table is always shown"))
            check(state["detail"] == DETAIL_HEADING[language].format(account=k["full"][language][DEFAULT_ACCOUNT[pid]]),
                  (name, state["detail"]))
            if width >= 720:
                assert_svg(page, width, pid, name, layouts)
                assert_svg_state(page, k, pid, card, last_step(k, card), language, name)
            press(page, "#step-first")
            assert_chain(page, k, pid, card, 0, language, f"{pid}-{card}-step0")
            # Start over writes the step 0 sentence; when the last step is 0 the button is at its edge and does nothing.
            status = page.evaluate("() => document.querySelector('#step-status').textContent")
            check(status == (expected_status(k, card, 0, language) if last_step(k, card) else ""), (pid, card, "step 0 status", status))
            if width >= 720:
                assert_svg(page, width, pid, f"{pid}-{card}-step0", layouts)
                assert_svg_state(page, k, pid, card, 0, language, f"{pid}-{card}-step0")
            press(page, "#step-last")
        assert_layout(page, width, pid + "-chain", layouts)
    shapes = page.evaluate(SHAPES)
    check(shapes["map"] == (3 if width >= 720 else 2), ("map table columns", shapes))
    check(shapes["mapInline"] == (width < 720) and shapes["mapCells"] == (width >= 720), ("entrances placement", shapes))
    # Steps of the office worker's breach: status text, the rows of this step, and the edge buttons keep the focus.
    k = known["worker"]
    page.locator("#person-worker").click()
    page.locator("#card-leak").click()
    page.locator("#step-first").focus()
    page.keyboard.press("Enter")
    page.evaluate("() => { window.__qaSvg = document.querySelector('#chain-figure svg'); }")
    if width >= 720:
        # With reduced motion the borders and lines declare no transition, and none starts when a step changes them.
        check(page.evaluate(TRANSITION_STYLE) == ["0s"], ("reduced motion: no transition declared", page.evaluate(TRANSITION_STYLE)))
        page.evaluate(TRANSITION_RECORDER)
    for step in (1, 2):
        page.locator("#step-next").focus()
        page.keyboard.press("Enter")
        assert_chain(page, k, "worker", "leak", step, language, f"worker-leak-step{step}")
        status = page.evaluate("() => document.querySelector('#step-status').textContent")
        check(status == expected_status(k, "leak", step, language), ("step status", step, status))
        if width >= 720:
            assert_svg_state(page, k, "worker", "leak", step, language, f"worker-leak-step{step}")
            # The diagram is repainted, not rebuilt. A transition would start within the next frames of the page.
            check(page.evaluate("() => document.querySelector('#chain-figure svg') === window.__qaSvg"), ("the diagram is kept", step))
            page.evaluate(FRAMES, 4)
            check(page.evaluate("() => window.__qaRuns") == [], ("reduced motion: no transition", step, page.evaluate("() => window.__qaRuns")))
            if step == 1:
                # Fallen boxes and cards and thick lines are drawn now: their colors, and the focus ring, in this theme
                assert_diagram_colors(page, "worker-leak-step1", layouts)
    before = page.evaluate("() => document.querySelector('#step-status').textContent")
    page.keyboard.press("Enter")
    check(page.evaluate(ACTIVE)["id"] == "step-next", "the focus stays on Next step at the last step")
    check(page.evaluate("() => document.querySelector('#step-status').textContent") == before, "an edge button does nothing")
    # Reduced motion: playback shows the last step at once and says how to go one step at a time, naming the two buttons.
    press(page, "#step-first")
    page.locator("#step-play").click()
    state = assert_chain(page, k, "worker", "leak", 2, language, "reduced-play")
    check(state["status"] == REDUCED_PLAY[language], ("reduced motion status", state["status"]))
    check(state["steps"]["play"]["pressed"] == "false", ("not playing", state["steps"]["play"]))
    check(page.evaluate(ACTIVE)["id"] == "step-play", "the focus stays on Play")
    for button in ("first", "next"):
        check(state["steps"][button]["text"] in state["status"], ("the guidance names the button", button, state["status"]))
    # Doing what it says: Start over, then Next step goes from step 0 to step 1.
    press(page, "#step-first")
    assert_chain(page, k, "worker", "leak", 0, language, "reduced-play: Start over")
    press(page, "#step-next")
    state = assert_chain(page, k, "worker", "leak", 1, language, "reduced-play: then Next step")
    check(state["status"] == expected_status(k, "leak", 1, language), ("step 1 after the guidance", state["status"]))
    # The step line follows a language change at once (the live region is cleared without a word).
    other = "en" if language == "ja" else "ja"
    page.locator("#language").click()
    state = page.evaluate(CHAIN_STATE)
    check(state["line"] == expected_line(k, "leak", 1, other), ("the step line in the other language", state["line"]))
    check(state["status"] == "", ("a language change clears the live region", state["status"]))
    page.locator("#language").click()
    check(page.evaluate(CHAIN_STATE)["line"] == expected_line(k, "leak", 1, language), "the step line back in the language")
    # A card whose last step is 0 (nothing falls to it): Start over and Next step would do nothing, so with reduced motion
    # playback writes the step 0 sentence and the summary, as playback does at its end.
    one_step = [(pid, card) for pid in PEOPLE for card in CARDS if last_step(known[pid], card) == 0]
    check(one_step, "the known vectors have a card whose last step is 0")
    for pid, card in one_step:
        page.locator("#person-" + pid).click()
        page.locator("#card-" + card).click()
        page.locator("#step-play").click()
        state = assert_chain(page, known[pid], pid, card, 0, language, f"{pid}-{card}: reduced-play with step 0 only")
        check(state["status"] == expected_status(known[pid], card, 0, language), (pid, card, "reduced-play at step 0", state["status"]))
        check(state["steps"]["play"]["pressed"] == "false", (pid, card, "not playing", state["steps"]["play"]))
    page.locator("#person-worker").click()
    page.locator("#card-leak").click()
    # Four cards at once: every cell against the known ranks, for the three people; the box stays open across redraws.
    page.locator("#four-cards > summary").click()
    for pid in PEOPLE:
        page.locator("#person-" + pid).click()
        assert_four_cells(page, known[pid], pid, language)
    page.locator("#person-worker").click()
    page.locator("#card-leak").click()
    page.locator("#card-simswap").click()
    check(page.locator("#four-cards").evaluate("el => el.open"), "the details stay open after a redraw")
    shapes = page.evaluate(SHAPES)
    check(shapes["four"] == 5, ("four cards table stays a grid", shapes))
    if width < 720:
        # Narrow screens: the headings stay on one line, and a name breaks only between words
        # (English at a space or after a hyphen, Japanese after "の").
        for pid in PEOPLE:
            page.locator("#person-" + pid).click()
            four = page.evaluate(FOUR_LINES)
            check(all(len(lines) == 1 for lines in four["heads"]), (pid, "four cards headings on one line", four["heads"]))
            for lines in four["rows"]:
                ends = [line[-1] for line in lines[:-1]]
                check(all(end in (" ", "-") for end in ends) if language == "en" else all(end == "の" for end in ends),
                      (pid, "a name breaks between words", lines))
        page.locator("#person-worker").click()
    page.locator("#four-cards > summary").click()
    # Names in the map table: on narrow screens the focus moves to the detail heading and back.
    button = page.locator('[data-key="chain-acct:bank"]')
    button.focus()
    page.keyboard.press("Enter")
    active = page.evaluate(ACTIVE)
    if width < 720:
        check(active["id"] == "detail-heading", ("narrow: focus to the detail", active))
        page.locator("#back-to-map").focus()
        page.keyboard.press("Enter")
        check(page.evaluate(ACTIVE)["key"] == "chain-acct:bank", "back to the name button")
    else:
        check(active["key"] == "chain-acct:bank", ("wide: focus stays", active))
        check(not page.locator("#back-to-map").is_visible(), "no back button on wide screens")
    check(page.locator("#detail-heading").inner_text() == DETAIL_HEADING[language].format(account=known["worker"]["full"][language]["bank"]),
          "the detail follows the name")
    for key in ("card:leak", "step:first"):
        page.locator(f'[data-key="{key}"]').focus()
        page.keyboard.press("Enter")
        check(page.evaluate(ACTIVE)["key"] == key, ("focus kept after a redraw", key))
    assert_layout(page, width, "chain-after-steps", layouts)


def test_lockout_tab(page, width, layouts, language, known):
    page.locator("#tab-lockout").click()
    # Changing the person resets the selected account to the person's default (the office worker is selected on entry).
    for pid in ("parent", "student", "worker"):
        k = known[pid]
        page.locator("#person-" + pid).click()
        state = page.evaluate(LOCK_STATE)
        table = k["vectors"]["lossTable"]
        check([row["id"] for row in state["rows"]] == k["services"], (pid, "lock rows"))
        for row in state["rows"]:
            check(row["tabindex"] is None, (pid, "lock name buttons stay in the Tab order"))
            check(row["pressed"] == str(row["id"] == DEFAULT_ACCOUNT[pid]).lower(), (pid, row["id"], row["pressed"]))
            check(len(row["cells"]) == len(table["columns"]), (pid, row["id"], "one cell per loss", len(row["cells"])))
            for column, cell in zip(table["columns"], row["cells"]):
                known_cell = table["cells"][column][row["id"]]
                kind = "plus" if known_cell["mark"] == "ok" and known_cell["plus"] else known_cell["mark"]
                # The whole cell: ○, ×, 消 (gone), or ○ with its partners written out
                expected = lock_text(k, known_cell, language)
                check(cell["text"] == expected, (pid, row["id"], column, cell, expected))
                check(bool(cell["sr"]), (pid, "read aloud", cell))
                if kind == "locked":
                    locked = cell["locked"]
                    check(locked and int(locked["weight"]) >= 700 and abs(locked["size"] - locked["cell"] * 1.2) < 0.6, (pid, locked))
        check(state["notes"] == 3, (pid, "three notes"))
        shapes = page.evaluate(SHAPES)
        check(shapes["lock"] == 4, (pid, "the lockout table keeps four columns", shapes))
        assert_layout(page, width, pid + "-lockout", layouts)
    button = page.locator('[data-key="lock-acct:shop"]')
    button.focus()
    page.keyboard.press("Enter")
    check(page.evaluate(ACTIVE)["key"] == "lock-acct:shop", "the focus stays on the name in the lockout table")
    check(button.get_attribute("aria-pressed") == "true", "the name is pressed")


def assert_tab_names(page, width, language, results):
    """At 320 and 390px the four tabs stay in one row, each name in two lines at most, broken only between words:
    a Japanese name at the places it allows (1手で／比べる at 320px), an English name at a space. The visible text and
    the name read aloud stay the plain name."""
    for selected in ("chain", "compare"):
        page.locator("#tab-" + selected).click()
        tabs = page.evaluate(TAB_LINES)
        check(len({tab["top"] for tab in tabs}) == 1 and len({tab["left"] for tab in tabs}) == 4, (width, "four tabs in one row", tabs))
        for tab, label in zip(tabs, TAB_LABELS[language]):
            check(tab["text"] == label, (width, "the text of the tab", tab))
            check(page.get_by_role("tab", name=label, exact=True).count() == 1, (width, "the tab is named by its plain text", label))
            check(1 <= len(tab["lines"]) <= 2, (width, selected, "two lines at most", tab))
            if language == "ja":
                check(tuple(tab["lines"]) in TAB_SPLITS[label], (width, selected, "a tab name breaks only between words", tab))
            else:
                check(" ".join(tab["lines"]) == label, (width, selected, "a tab name breaks at a space", tab))
        if width == 320 and language == "ja":
            compare = next(tab for tab in tabs if tab["id"] == "tab-compare")
            check(compare["lines"] == ["1手で", "比べる"], (width, selected, "1手で／比べる", compare))
        results.append({"state": "tab-names-" + selected, "tabs": tabs})
    page.locator("#tab-chain").click()


def test_narrow_tables(page, width, language, known, results):
    """Below 720px: the map table (two columns) and the lockout table (four columns) of the three people never run past
    the panel and keep every word whole; the lockout table may split words only when whole words cannot fit the panel.
    The office worker's map table and the parent's lockout table stay within the guide heights (without the caption).
    No <wbr> stands before a mark that may not start a line."""
    for pid in PEOPLE:
        page.locator("#person-" + pid).click()
        page.locator("#tab-chain").click()
        page.locator("#card-leak").click()
        # Both tables of the person are drawn: every <wbr> keeps a mark such as ・ or ） with the character before it
        starts = [pair for pair in page.evaluate(WBR_NEXT) if pair[1] and pair[1] in NO_LINE_START]
        check(not starts, (pid, "a <wbr> before a mark that may not start a line", starts))
        for edge in ("first", "last"):
            press(page, "#step-" + edge)
            table = page.evaluate(NARROW_TABLE, "#chain-map")
            name = f"{pid}-map-{edge}"
            check(table["columns"] == 2 and table["width"] <= table["frame"] + 0.5, (name, "two columns inside the panel", table))
            check(not table["split"], (name, "a word is split in the map table", table["split"]))
            check(table["minFont"] >= 14, (name, "text of the map table", table["minFont"]))
            limit = TABLE_LIMITS.get(("map", width, language))
            if pid == "worker" and edge == "first" and limit is not None:
                check(table["body"] <= limit, (name, "height of the map table without the caption", table["body"], limit))
            results.append({"state": name, "table": table})
        page.locator("#tab-lockout").click()
        table = page.evaluate(NARROW_TABLE, "#lock-map")
        name = f"{pid}-lock"
        check(table["columns"] == 4 and table["width"] <= table["frame"] + 0.5, (name, "four columns inside the panel", table))
        check(table["minFont"] >= 14, (name, "text of the lockout table", table["minFont"]))
        if table["breakWords"]:
            check(table["wholeWidth"] > table["frame"] + 0.5, (name, "words are split only when whole words do not fit", table))
            check(width == 320, (name, "a 390px panel fits whole words", table))
        else:
            check(not table["split"], (name, "a word is split in the lockout table", table["split"]))
        # When whole words do not fit, English splits a word only where it may be hyphenated, with an ASCII hyphen (both test
        # browsers have the dictionary); Japanese splits anywhere. Without hyphenation the cells split anywhere and the table
        # still fits.
        style = page.evaluate(LOCK_HYPHENS)
        if table["breakWords"] and language == "en":
            check(style == {"hyphens": "auto", "character": '"-"', "wrap": "break-word", "anywhere": False},
                  (name, "English splits at hyphenation points", style))
            page.evaluate(NO_HYPHENS, True)
            fallback = page.evaluate(NARROW_TABLE, "#lock-map")
            check(page.evaluate(LOCK_HYPHENS)["anywhere"] and fallback["width"] <= fallback["frame"] + 0.5,
                  (name, "without hyphenation the cells split anywhere, inside the panel", fallback))
            page.evaluate(NO_HYPHENS, False)
            check(page.evaluate(LOCK_HYPHENS) == style, (name, "hyphenation again after the resize", page.evaluate(LOCK_HYPHENS)))
        elif table["breakWords"]:
            check(style["wrap"] == "anywhere" and style["hyphens"] != "auto", (name, "Japanese splits anywhere", style))
        # ＋ stays with the word before it, never alone on a line ("○（＋番号か＋プロバイダーのメールで×）")
        alone = [lines for lines in page.evaluate(BOX_LINES, "#lock-map th, #lock-map td") if "＋" in lines]
        check(not alone, (name, "a line with ＋ alone", alone))
        limit = TABLE_LIMITS.get(("lock", width, language))
        if pid == "parent" and limit is not None:
            check(table["body"] <= limit, (name, "height of the lockout table without the caption", table["body"], limit))
        results.append({"state": name, "table": table})
    page.locator("#tab-chain").click()
    page.locator("#person-worker").click()


# Opens every <details> under a part of the page and returns their earlier state, or puts a returned state back
OPEN_DETAILS = """([where, states]) => { const all = Array.from(document.querySelectorAll(where + ' details'));
  if (states) { all.forEach((d, i) => { d.open = states[i]; }); return null; }
  const before = all.map(d => d.open); all.forEach(d => { d.open = true; }); return before; }"""


def test_table_words(page, width, language, results):
    """Every table keeps each Japanese word whole (it breaks at a <wbr>, a space or after punctuation): tab 1 and tab 2 of
    the three people, tab 3 with the suggested change of every mode, tab 4 and the ten lessons, their <details> opened
    for the check and closed again. The lockout table with .break-words (a 320px panel too narrow for whole words) is
    left to test_narrow_tables. Leaves tab 1 and the office worker."""
    boxes = ("caption", "th", "td")
    counted = []

    def assert_tables(where, name):
        before = page.evaluate(OPEN_DETAILS, [where, None])
        split = page.evaluate(TEXT_SPLITS, [f"{where} table:not(.break-words) {box}" for box in boxes])
        page.evaluate(OPEN_DETAILS, [where, before])
        check(not any(split.values()), (name, "a word is split in a table", split))
        counted.append(name)
    for pid in PEOPLE:
        page.locator("#person-" + pid).click()
        page.locator("#tab-chain").click()
        assert_tables("#panel-chain", f"{pid}-chain")
        page.locator("#tab-lockout").click()
        assert_tables("#panel-lockout", f"{pid}-lockout")
        page.locator("#tab-compare").click()
        for mode in MODES:
            page.locator("#mode-" + mode).click()
            assert_tables("#panel-compare", f"{pid}-compare-{mode}")
    page.locator("#tab-rules").click()
    assert_tables("#panel-rules", "rules")
    press(page, "#help")
    assert_tables("#help-dialog", "lessons")
    page.keyboard.press("Escape")
    page.locator("#tab-chain").click()
    page.locator("#person-worker").click()
    results.append({"state": f"table-words-{width}-{language}", "checked": len(counted)})


STEP_TEXT = ["#step-line", "#step-summary"]
DETAIL_TEXT = ["#detail-body .detail-entrances li", "#detail-body .detail-falls", "#detail-body .detail-backdoor",
               "#detail-body .detail-need"]


def test_word_lines(page, width, language, results):
    """Below 720px: the step line and the summary at every step of every card of the three people, and the lines of the
    detail box for every account and card, keep each word whole (they break at a <wbr>, a space or after punctuation).
    The card buttons of tab 1 and the mode buttons of tab 3 have the same size, and no name is split inside a word.
    Leaves the office worker, the breach card at its last step and the first account selected."""
    page.locator("#tab-chain").click()
    counted = {"steps": 0, "details": 0}
    for pid in PEOPLE:
        page.locator("#person-" + pid).click()
        accounts = page.evaluate("() => Array.from(document.querySelectorAll('#chain-map tbody th button'), b => b.dataset.key)")
        for card in CARDS:
            page.locator("#card-" + card).click()
            press(page, "#step-first")
            while True:
                state = page.evaluate(CHAIN_STATE)
                split = page.evaluate(TEXT_SPLITS, STEP_TEXT)
                check(not any(split.values()), (pid, card, state["line"], "the step line or the summary splits a word", split))
                counted["steps"] += 1
                if state["steps"]["next"]["disabled"] == "true":
                    break
                press(page, "#step-next")
            for key in accounts:
                page.locator(f'[data-key="{key}"]').click()
                split = page.evaluate(TEXT_SPLITS, DETAIL_TEXT)
                check(not any(split.values()), (pid, card, key, "a line of the detail box splits a word", split))
                counted["details"] += 1
    page.locator("#card-leak").click()
    page.locator("#person-parent").click()
    page.locator("#person-worker").click()
    # The same card names in tab 1 and tab 3 (窓口のなりすまし on one line of a 320px column)
    sizes = page.evaluate("() => Array.from(document.querySelectorAll('.card-buttons button, .mode-buttons button'), "
                          "b => getComputedStyle(b).fontSize)")
    cards = page.evaluate(TEXT_SPLITS, [".card-buttons button"])
    page.locator("#tab-compare").click()
    modes = page.evaluate(TEXT_SPLITS, [".mode-buttons button"])
    page.locator("#tab-chain").click()
    check(len(set(sizes)) == 1, ("the card and mode buttons have the same size", sorted(set(sizes))))
    check(not any(cards.values()) and not any(modes.values()), ("a card or mode name splits a word", cards, modes))
    results.append({"state": f"word-lines-{width}-{language}", **counted, "buttonFont": sizes[0]})


def tab_until(page, reached, limit=40):
    """Press Tab until the focused element satisfies reached(active)."""
    for _ in range(limit):
        active = page.evaluate(ACTIVE)
        if reached(active):
            return active
        page.keyboard.press("Tab")
    raise AssertionError(("not reached by Tab", page.evaluate(ACTIVE)))


def tab_to(page, key, limit=40):
    return tab_until(page, lambda active: active["key"] == key, limit)


def lock_cells(page, account):
    return next(row["cells"] for row in page.evaluate(LOCK_STATE)["rows"] if row["id"] == account)


def test_highlights(page, width, language, known):
    """W1, P1, P2, S1-S3 by keyboard only: the state they set, the focus target in the viewport (P2 and S3 with the caption
    and the column headings of the lockout table), then Tab and Shift+Tab. Below 720px, P2 and S3 again with the highlight
    at the top of the screen; at 320px, S3 on a screen 420px high (the name then comes into view without the caption)."""
    for hid, pid, position, target in HIGHLIGHTS_1B:
        k = known[pid]
        page.locator("#person-" + pid).focus()
        page.keyboard.press("Enter")
        tab_until(page, lambda active: active["id"].startswith("tab-"), 6)
        page.keyboard.press("Home")
        page.keyboard.press("Tab")
        check(page.evaluate(ACTIVE)["id"] == "panel-chain", (hid, "the panel of the chain tab"))
        tab_to(page, "hl:" + hid, 8)
        check(page.evaluate(CHAIN_STATE)["highlights"][position] == hid, (hid, "position among the person's highlights"))
        page.keyboard.press("Enter")
        focused = page.locator(target)
        check(focused.evaluate("el => el === document.activeElement"), (hid, "focus target", page.evaluate(ACTIVE)))
        view = focused.evaluate(IN_VIEW)
        check(view["inside"], (hid, "the target is in the viewport", view))
        if hid in ("P2", "S3"):
            # The caption and the column headings of the lockout table come into view with the name, so that the column
            # of each mark can be read (a name scrolled alone to the top of a narrow screen would leave them above it)
            for part in ("caption", "thead"):
                head = page.locator("#lock-map " + part).evaluate(IN_VIEW)
                check(head["inside"], (hid, "the " + part + " of the lockout table is in the viewport with the name", head, view))
        check(page.locator("#person-status").text_content()
              == STATUS_HIGHLIGHT[language].format(title=HIGHLIGHT_TITLES[hid][language]), (hid, "highlight status"))
        if hid in ("W1", "S1"):
            card = "leak"
            account = DEFAULT_ACCOUNT[pid] if hid == "S1" else "mailMain"
            state = assert_chain(page, k, pid, card, 0, language, hid)
            check(next(r for r in state["rows"] if r["id"] == account)["pressed"] == "true", (hid, "selected account"))
            # W1: any one of the four cards; S1: the brokerage notes, the student's included (the detail shows the last step).
            details = page.evaluate(DETAIL_TEXTS)
            check(details == expected_detail(k, card, account, language), (hid, "detail", details))
            if width >= 720:
                assert_svg_state(page, k, pid, card, 0, language, hid)
            for step in range(1, last_step(k, card) + 1):
                page.keyboard.press("Enter")
                assert_chain(page, k, pid, card, step, language, f"{hid}-step{step}")
                if width >= 720:
                    assert_svg_state(page, k, pid, card, step, language, f"{hid}-step{step}")
            check(page.evaluate(DETAIL_TEXTS) == details, (hid, "the detail does not follow the step"))
        elif hid in ("P1", "S2"):
            card, account = ("simswap", "bank") if hid == "P1" else ("mail", "mailUni")
            state = assert_chain(page, k, pid, card, last_step(k, card), language, hid)
            check(state["detail"] == DETAIL_HEADING[language].format(account=k["full"][language][account]), (hid, state["detail"]))
            check(next(r for r in state["rows"] if r["id"] == account)["pressed"] == "true", (hid, "selected account"))
            if width >= 720:
                assert_svg_state(page, k, pid, card, last_step(k, card), language, hid)
            if hid == "P1":
                fallen = [r["id"] for r in state["rows"] if r["cell"] != CELL_NONE[language]]
                check(fallen == ["bank"], (hid, "only the bank falls", fallen))
                check(CELL_BACKDOOR[language] in next(r for r in state["rows"] if r["id"] == "bank")["cell"], (hid, "backdoor"))
                # Step 1 through the SMS reset, a backdoor, and the SIM swap alone is enough.
                details = page.evaluate(DETAIL_TEXTS)
                check(details == expected_detail(k, card, account, language), (hid, "detail", details))
            else:
                check(all(r["cell"] != CELL_NONE[language] for r in state["rows"]), (hid, "all seven fall"))
        else:
            check(page.locator("#tab-lockout").get_attribute("aria-selected") == "true", (hid, "lockout tab"))
            account = "bank" if hid == "P2" else "sub"
            cells = [cell["text"] for cell in lock_cells(page, account)]
            if hid == "P2":
                plus = "○（＋番号で×）" if language == "ja" else "○ (× if the number goes too)"
                check(cells == [plus, "×", plus], (hid, cells))
            else:
                plus = "○（＋大学のメールで×）" if language == "ja" else "○ (× if the university email goes too)"
                check(cells == [plus, plus, "×"], (hid, cells))
                gone = [cell["text"] for cell in lock_cells(page, "mailUni")][2]
                check(gone == LOCK_MARKS[language]["gone"], (hid, "the university email is gone", gone))
            check(focused.get_attribute("tabindex") is None, (hid, "the name button has no tabindex"))
        if hid in ("W1", "S1"):
            check(focused.get_attribute("tabindex") is None, (hid, "Next step has no tabindex"))
        # Tab and Shift+Tab move to the elements after and before the target.
        handle = focused.element_handle()
        focused.focus()
        page.keyboard.press("Tab")
        after = page.evaluate_handle("() => document.activeElement")
        check(page.evaluate(ORDER, [handle, after]), (hid, "Tab moves forward", page.evaluate(ACTIVE)))
        focused.focus()
        page.keyboard.press("Shift+Tab")
        before = page.evaluate_handle("() => document.activeElement")
        check(page.evaluate(ORDER, [before, handle]), (hid, "Shift+Tab moves back", page.evaluate(ACTIVE)))
    if width < 720:
        # P2 and S3 pressed with the highlight at the top of a narrow screen: the page brings up the caption and the column
        # headings of the lockout table with the name (the focus alone would leave them above the screen)
        for hid, pid, account in (("P2", "parent", "bank"), ("S3", "student", "sub")):
            page.locator("#person-" + pid).click()
            page.locator("#tab-chain").click()
            button = page.locator(f'[data-key="hl:{hid}"]')
            button.focus()
            button.evaluate("el => el.scrollIntoView({block: 'start'})")
            page.keyboard.press("Enter")
            for part in (f'[data-key="lock-acct:{account}"]', "#lock-map caption", "#lock-map thead"):
                view = page.locator(part).evaluate(IN_VIEW)
                check(view["inside"], (hid, "pressed at the top of the screen", part, "in the viewport", view))
    if width == 320:
        # A screen too low for the caption, the headings and the name together: the name comes to the bottom, with the focus
        page.set_viewport_size({"width": width, "height": 420})
        page.locator("#tab-chain").click()
        page.locator('[data-key="hl:S3"]').focus()
        page.keyboard.press("Enter")
        name = page.locator('[data-key="lock-acct:sub"]')
        view = name.evaluate(IN_VIEW)
        check(name.evaluate("el => el === document.activeElement") and view["inside"], ("S3 on a low screen: the name in view", view))
        page.set_viewport_size({"width": width, "height": 900})


# ===== Stage 1c: tab 3 (try one change), the map after a change, and the highlights W2, W3, P3 =====
MODES = ("leak", "simswap", "mail", "desk", "all", "lockout")
MODE_LABELS = {"ja": ("漏えい", "SIMスワップ", "メールの乗っ取り", "窓口のなりすまし", "4枚の合計", "閉め出しを減らす"),
               "en": ("Breach", "SIM swap", "Email takeover", "Help-desk impersonation", "All four cards", "Fewer lockouts")}
# The candidates table of the spec: per person and mode, the changes in their order (the suggestion first) with the effect
# line in Japanese and in English, or the reason when no change qualifies.
CANDIDATES = {
    "worker": {
        "leak": (("replace:points.login:pw:red>pw:own-points", "守れる5（★1）", "Saves: 5 (★1)"),
                 ("add:mailMain.login:+device", "守れる4（★1）", "Saves: 4 (★1)"),
                 ("replace:sns.recMail:mailMain>mailOld", "守れる1・2つ同時で新たに×1", "Saves: 1 · New two-at-once lockouts: 1")),
        "simswap": (("replace:mailMain.recSms:phone>paper:mailMain", "守れる6（★2）", "Saves: 6 (★2)"),
                    ("replace:sec.recMailSms:mailMain>mailOld", "守れる1（★1）・2つ同時で新たに×1",
                     "Saves: 1 (★1) · New two-at-once lockouts: 1"),
                    ("replace:points.recMail:mailMain>mailOld", "守れる1", "Saves: 1")),
        "mail": (("replace:mailMain.recMail:mailOld>paper:mailMain", "守れる6（★1）", "Saves: 6 (★1)"),
                 ("replace:shop.recMail:mailMain>paper:shop", "守れる1", "Saves: 1"),
                 ("replace:sns.recMail:mailMain>paper:sns", "守れる1・2つ同時で新たに×1", "Saves: 1 · New two-at-once lockouts: 1")),
        "desk": (("replace:mailOld.recDesk:info>idcheck", "守れる7（★1）", "Saves: 7 (★1)"),
                 ("replace:mailMain.recMail:mailOld>paper:mailMain", "守れる6（★1）", "Saves: 6 (★1)"),
                 ("replace:shop.recMail:mailMain>paper:shop", "守れる1", "Saves: 1")),
        "all": (("replace:mailMain.recMail:mailOld>paper:mailMain", "守れる（延べ）12（★2）", "Saves (sum over 4 cards): 12 (★2)"),
                ("replace:mailMain.recSms:phone>paper:mailMain", "守れる（延べ）6（★2）", "Saves (sum over 4 cards): 6 (★2)"),
                ("replace:mailOld.recDesk:info>idcheck", "守れる（延べ）7（★1）", "Saves (sum over 4 cards): 7 (★1)")),
        "lockout": "noLockout",
    },
    "parent": {
        "leak": (("replace:points.login:pw:yellow>pw:own-points", "守れる3（★1）", "Saves: 3 (★1)"),
                 ("replace:mailIsp.login:pw:yellow>pw:own-mailIsp", "守れる1（★1）", "Saves: 1 (★1)")),
        "simswap": (("replace:bank.recSms:phone>idcheck", "守れる1（★1）", "Saves: 1 (★1)"),),
        "mail": (("replace:shop.recMail:mailIsp>paper:shop", "守れる1", "Saves: 1"),
                 ("replace:photo.recMail:mailIsp>paper:photo", "守れる1", "Saves: 1"),
                 ("remove:points.recMail", "守れる1", "Saves: 1")),
        "desk": (("replace:mailIsp.recDesk:info>idcheck", "守れる4（★1）", "Saves: 4 (★1)"),
                 ("replace:shop.recMail:mailIsp>paper:shop", "守れる1", "Saves: 1"),
                 ("replace:photo.recMail:mailIsp>paper:photo", "守れる1", "Saves: 1")),
        "all": (("replace:mailIsp.recDesk:info>idcheck", "守れる（延べ）4（★1）", "Saves (sum over 4 cards): 4 (★1)"),
                ("replace:points.login:pw:yellow>pw:own-points", "守れる（延べ）3（★1）", "Saves (sum over 4 cards): 3 (★1)"),
                ("replace:bank.recSms:phone>idcheck", "守れる（延べ）1（★1）", "Saves (sum over 4 cards): 1 (★1)")),
        "lockout": (("replace:bank.recSms:phone>idcheck", "閉め出しが解ける1", "Unlocks: 1"),
                    ("replace:bank.login:phone>device", "閉め出しが解ける1", "Unlocks: 1")),
    },
    "student": {
        "leak": (("replace:game.login:pw:green>pw:own-game", "守れる4（★3）", "Saves: 4 (★3)"),
                 ("add:mailFree.login:+device", "守れる3（★2）", "Saves: 3 (★2)"),
                 ("add:sns.login:+device", "守れる1（★1）・2つ同時で新たに×1", "Saves: 1 (★1) · New two-at-once lockouts: 1")),
        "simswap": (("replace:mailFree.recSms:phone>paper:mailFree", "守れる3（★2）", "Saves: 3 (★2)"),
                    ("replace:sec.recMail:mailFree>mailUni", "守れる1（★1）・2つ同時で新たに×1",
                     "Saves: 1 (★1) · New two-at-once lockouts: 1"),
                    ("replace:game.recMail:mailFree>mailUni", "守れる1", "Saves: 1")),
        "mail": (("replace:mailFree.recMail:mailUni>paper:mailFree", "守れる4（★2）", "Saves: 4 (★2)"),
                 ("replace:sns.recMail:mailUni>paper:sns", "守れる1（★1）", "Saves: 1 (★1)"),
                 ("replace:sec.recMail:mailFree>paper:sec", "守れる1（★1）・2つ同時で新たに×1",
                  "Saves: 1 (★1) · New two-at-once lockouts: 1")),
        "desk": "noFall",
        "all": (("replace:game.login:pw:green>pw:own-game", "守れる（延べ）4（★3）", "Saves (sum over 4 cards): 4 (★3)"),
                ("replace:sec.recMail:mailFree>paper:sec", "守れる（延べ）3（★3）・2つ同時で新たに×1",
                 "Saves (sum over 4 cards): 3 (★3) · New two-at-once lockouts: 1"),
                ("replace:mailFree.recMail:mailUni>paper:mailFree", "守れる（延べ）4（★2）", "Saves (sum over 4 cards): 4 (★2)")),
        "lockout": (("replace:sub.login:mailUni>mailFree", "閉め出しが解ける1・新たに倒れる（延べ）2",
                     "Unlocks: 1 · Newly fallen (sum over 4 cards): 2"),),
    },
}
REASONS = {
    "noFall": {"ja": "このカードでは倒れるアカウントがないので、守る手はありません。",
               "en": "No account falls to this card, so there is nothing to protect."},
    "noLockout": {"ja": "{person}は、1つ失っただけで入れなくなるアカウントがありません。2つ同時の閉め出しは、1手を選ぶと1行で出ます。",
                  "en": "{person}: no account is locked out by a single loss. Two-at-once lockouts appear as one line once you pick a change."},
}
NO_MOVE = {"ja": "上の候補か「1手を自分で選ぶ」から手を選ぶと、前後を並べます。",
           "en": "Pick a change from the suggestions above or from “Choose a change yourself” to compare before and after."}
CHOOSE = {"ja": ("1手を自分で選ぶ", "（1手を選ぶ）"), "en": ("Choose a change yourself", "(choose a change)")}
# The ranking notes of the spec's screen text table, written out (rankingCards for the card modes and the sum of the four,
# then rankingLockout)
RANKING_TEXT = {
    "ja": ("閉め出しを1つでも増やす手は後ろに並べます。そのうえで、差し引きで守れる★（重要）の数（多い順）→差し引きで守れる数（多い順）"
           "→閉め出しの増減（少ない順）→4枚のカードで新たに倒れる数（延べ、少ない順）の順です。差し引きは、守れた数から、同じカード（4枚の合計"
           "では4枚）で新たに倒れた数を引いた数です。ボタンの「守れる」は引く前の数で、新たに倒れる数があればボタンに別に出します。同点なら足す"
           "→付け替え→外すの順です。閉め出しは1つの喪失で数え、2つ同時は並べ方に入れていません。",
           "閉め出しの増減（減る手が先）→4枚のカードで新たに倒れる数（延べ、少ない順）→差し引きで守れる★の数（4枚の延べ、多い順）→差し引きで"
           "守れる数（4枚の延べ、多い順）の順です。同点なら足す→付け替え→外すの順です。"),
    "en": ("Changes that add any lockout go last. The rest are ranked by ★ (important) accounts saved on balance (more first), then "
           "accounts saved on balance (more first), then the change in lockouts (smaller first), then accounts newly falling, summed over "
           "the four cards (fewer first). On balance means saved minus newly falling to the same card (all four for the total); the "
           "“Saves” on each button is before subtraction, and any newly falling accounts are shown separately. Ties go add → replace → "
           "remove. Lockouts are counted for single losses; two-at-once losses are not used for ranking.",
           "Ranked by the change in lockouts (largest decrease first), then accounts newly falling, summed over the four cards (fewer "
           "first), then ★ accounts saved on balance, then accounts saved on balance, both summed over the four cards (more first). "
           "Ties go add → replace → remove."),
}
MAP_CARD = {"ja": "地図のカード：{card}（最後の段）", "en": "Card on the map: {card} (last step)"}
# Known rows of the map after a change (the spec's tests D and F): after each person's breach suggestion only the breached
# service falls, at step 1 through its changed log-in; after the student's STUDENT_SUB (SIM swap) the subscription falls at
# step 2 through the changed log-in, as a backdoor. (person, change, card): account, step, entrance used, backdoor, last step
OWN_LOGIN = {"ja": "ログイン：独自", "en": "Log-in: Own"}
AFTER_KNOWN = {
    ("worker", "replace:points.login:pw:red>pw:own-points", "leak"): ("points", 1, OWN_LOGIN, False, 1),
    ("parent", "replace:points.login:pw:yellow>pw:own-points", "leak"): ("points", 1, OWN_LOGIN, False, 1),
    ("student", "replace:game.login:pw:green>pw:own-game", "leak"): ("game", 1, OWN_LOGIN, False, 1),
    ("student", "replace:sub.login:mailUni>mailFree", "simswap"): ("sub", 2, {"ja": "ログイン：フリーメール", "en": "Log-in: Free email"}, True, 2),
}
SR_FALLEN = {"ja": "段{rank}で倒れる。開けた入口：{via}", "en": "Falls at step {rank}. Entrance used: {via}."}
ATTACK_HEADS = {"ja": ("カード", "前", "後", "守れた", "新たに倒れる"), "en": ("Card", "Before", "After", "Saved", "Newly fallen")}
ATTACK_TOTAL = {"ja": "合計（延べ）", "en": "Total"}
ATTACK_MODE = {"ja": "選んだカード", "en": "selected card"}
CHANGED_TAG = {"ja": "変更", "en": "changed"}
SAME_HEADS = {"ja": ("手", "守れた（延べ）", "新たに倒れる（延べ）", "閉め出し（1つ）", "2つ同時"),
              "en": ("Change", "Saved (sum over 4 cards)", "Newly fallen (sum over 4 cards)", "Lockout (one loss)", "Two at once")}
LOCK_PHASE = {"ja": "{loss}（{phase}）", "en": "{loss} ({phase})"}
LOCK_HEADS = {"ja": ("スマホ", "番号"), "en": ("Phone", "Number")}
LOCK_NONE = {"ja": "閉め出し：変わらない", "en": "Lockout: no change"}
PAIR_NONE = {"ja": "2つ同時に失ったとき：変わらない", "en": "Losing two at once: no change"}
ATTACK_NONE = {"ja": "攻撃：どのカードでも変わらない", "en": "Attack: no change for any card"}
W2_MOVE, W3_MOVE, P3_MOVE = "replace:mailMain.recMail:mailOld>paper:mailMain", "remove:sec.recMailSms", "replace:bank.recSms:phone>idcheck"
WORKER_LEAK = "replace:points.login:pw:red>pw:own-points"
STUDENT_SUB = "replace:sub.login:mailUni>mailFree"
# Known sentences of the spec: the change sentence (the heading of the comparison) and the summary lines
KNOWN_TITLES = {
    ("worker", W2_MOVE): {"ja": "メインのメール：復旧（予備のメールで再設定）の古いメールを紙の回復コードに付け替える",
                          "en": "Main email: in recovery (Reset via backup email), replace the old email with paper recovery codes"},
    ("worker", W3_MOVE): {"ja": "ネット証券：復旧（メール＋SMSでパスキーを再登録）を外す",
                          "en": "Online brokerage: remove recovery (Re-register passkey by email + SMS)"},
    ("parent", P3_MOVE): {"ja": "銀行のネットバンキング：復旧（SMSで再設定）の電話番号（SMS）を書類での本人確認に付け替える",
                          "en": "Online banking: in recovery (Reset by SMS), replace the phone number (SMS) with a document check"},
    ("worker", WORKER_LEAK): {"ja": "ポイントアプリ：ログイン（パスワード）のパスワード 赤Aをこのアカウントだけの系統に付け替える",
                              "en": "Points app: in log-in (Password), replace Password Red A with a family used only here"},
}
# The summary of P3 is put together from the sentence types of the spec, the data label of the bank and the known vectors
# (the SIM swap saves the bank; giving up the number no longer locks the bank out).
KNOWN_SUMMARIES = {
    ("worker", W3_MOVE): {"ja": ["攻撃：SIMスワップでネット証券を守れる", "閉め出し：スマホをなくすと、ネット証券に入れなくなる"],
                          "en": ["Attack (saved from SIM swap): Online brokerage",
                                 "Lockout: If you lose the phone, you can no longer get into: Online brokerage"]},
    ("worker", W2_MOVE): {"ja": ["攻撃：メールの乗っ取りと窓口のなりすましでメインのメールなど6つを守れる", "閉め出し：変わらない"],
                          "en": ["Attack (saved from Email takeover and Help-desk impersonation): Main email and others (6 in all)",
                                 "Lockout: no change"]},
    ("parent", P3_MOVE): {"ja": ["攻撃：SIMスワップで銀行のネットバンキングを守れる", "閉め出し：番号を手放しても、銀行のネットバンキングに入れるようになる"],
                          "en": ["Attack (saved from SIM swap): Online banking",
                                 "Lockout: Even after giving up the number, you can now get into: Online banking"]},
    ("student", STUDENT_SUB): {"ja": ["攻撃：漏えいとSIMスワップで動画のサブスクが新たに倒れる",
                                      "閉め出し：大学のメールが消えても、動画のサブスク（学割）に入れるようになる"],
                               "en": ["Attack (newly falls to Breach and SIM swap): Video subscription",
                                      "Lockout: Even after the university email is gone, you can now get into: Video subscription (student plan)"]},
}
# The notes after a change (the spec: the help-desk note, the 2nd to 4th sentences of the paper note, the removal note, the
# note on a family of its own, the phone note of the lockout tab, and the note for a change that changes nothing)
NOTES = {
    "desk": {"ja": "電話の窓口は個人情報で通ります。この模型には、書類での本人確認を破るカードも、本人が書類をなくすカードもありません。"
                   "このため、書類の確認へ付け替える手で、攻撃と閉め出しが悪くなることはありません。実際には書類は偽造で破られることがあり、"
                   "窓口での回復には待ち時間もかかります。実在の本人確認の手順は書きません。",
             "en": "A phone help desk accepts personal details. This model has no card that defeats a document check and no card for the "
                   "owner losing their documents, so moving a line to a document check never makes the attack or the lockout worse here. "
                   "In reality documents can be forged, and recovery at a desk takes time. Real identity-check procedures are not described."},
    "paper": {"ja": "この模型には紙を攻撃者に渡すカードがないので、紙へ付け替える手で攻撃の面が悪くなることはありません。"
                    "実際には置き場所が新しい入口になり、打ち込む場面では偽サイトに強くありません。閉め出しの面では、紙をほかのものと一緒になくすと"
                    "入れなくなることがあります。",
              "en": "No card here hands the paper codes to the attacker, so moving a line to paper codes never makes the attack side worse. "
                    "In reality, where you keep them becomes a new entrance, and they are not phishing-resistant when you type them in. "
                    "On the lockout side, losing the paper codes together with something else can lock you out."},
    "remove": {"ja": "外す手の閉め出しは、喪失カード（スマホ・番号・メール）で数えています。パスワードを忘れることは模型に入れていないので、"
                     "パスワードでログインするアカウントでは、外しても閉め出しが増えないように見えます。実際には、パスワードを忘れたときに戻る道がなくなります。",
               "en": "Lockout for a removal is counted with the loss cards (phone, number, email). Forgetting a password is not in the model, "
                     "so for accounts that log in with a password, removing a recovery entrance can look as if it adds no lockout. "
                     "In reality, you lose your way back in if you forget the password."},
    "own": {"ja": "漏れたサービスのパスワードを独自にすると、漏えいのカードが渡すのはその新しい系統だけになり、ほかの使い回し先へ広がりません。",
            "en": "If the breached service gets a family of its own, the breach card gives only that new family, "
                  "and the leak no longer spreads to the accounts that reused the old one."},
    "sync": {"ja": "「スマホをなくした」の値は、認証アプリやパスキーを、ほかの端末やクラウドに移していない（同期・バックアップしていない）場合の値です。",
             "en": "The “Lost the phone” values assume the authenticator app and passkeys are not synced or backed up to another device or the cloud."},
}
KNOWN_NOTES = {("worker", W2_MOVE): ("paper",), ("worker", W3_MOVE): ("remove", "sync"), ("parent", P3_MOVE): ("desk",),
               ("worker", WORKER_LEAK): ("own",)}
# W3: the five changes to the brokerage re-registration (the same-entrance table of the spec)
W3_SAME = {
    "ja": ("ネット証券の復旧（メール＋SMSでパスキーを再登録）を変える手（5）",
           (("メインのメール→古いメール", "1", "0", "－", "新たに：スマホと古いメール"),
            ("メインのメール→紙", "1", "0", "－", "新たに：スマホと紙"),
            ("SMS→紙", "1", "0", "－", "スマホと番号→スマホと紙"),
            ("SMS→書類", "1", "0", "－", "解ける：スマホと番号"),
            ("外す", "1", "0", "新たに×：ネット証券（スマホ）", "－"))),
    "en": ("Online brokerage: changes to recovery (Re-register passkey by email + SMS) (5)",
           (("Main email → Old email", "1", "0", "–", "New: Phone and Old email"),
            ("Main email → Paper codes", "1", "0", "–", "New: Phone and Paper codes"),
            ("SMS → Paper codes", "1", "0", "–", "Phone and Number → Phone and Paper codes"),
            ("SMS → Documents", "1", "0", "–", "Unlocked: Phone and Number"),
            ("Remove", "1", "0", "Newly locked out: Online brokerage (Phone)", "–"))),
}
HIGHLIGHT_TITLES.update({
    "W2": {"ja": "メインのメールの予備を紙に付け替える1手", "en": "Replace the main email's backup email with paper codes"},
    "W3": {"ja": "証券の再登録を外すと、スマホをなくしたとき入れない",
           "en": "Remove the brokerage re-registration, and losing the phone locks you out"},
    "P3": {"ja": "銀行の再設定を書類の確認へ。両方が止まる1手", "en": "Move the bank reset to a document check: one change stops both"},
})
# The highlights measured in stage 1c: id, person, position among the person's three, the change and the mode they choose
HIGHLIGHTS_1C = (("W2", "worker", 1, W2_MOVE, "all"), ("W3", "worker", 2, W3_MOVE, "simswap"), ("P3", "parent", 2, P3_MOVE, "simswap"))
# The text shown of an element: text nodes that are rendered (not display: none) and not inside .visually-hidden
SHOWN = """el => { if (!el) return null; let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) { const parent = node.parentElement;
    if (parent.closest('.visually-hidden') || !parent.getClientRects().length) continue; text += node.data; }
  return text.replace(/\\s+/g, ' ').trim(); }"""
COMPARE_STATE = """() => {
  const shownText = """ + SHOWN + """;
  const shown = el => !!el && el.getClientRects().length > 0;
  const hiddenText = el => Array.from(el.querySelectorAll('.visually-hidden'), n => n.textContent).join('');
  const value = cell => shownText(cell.querySelector('.cell-value') || cell);
  const body = sel => Array.from(document.querySelectorAll(sel + ' tbody tr'));
  const select = document.querySelector('#choose-move'), heading = document.querySelector('#compare-heading');
  const summary = document.querySelector('#compare-summary');
  return {
    modes: Object.fromEntries(Array.from(document.querySelectorAll('.mode-buttons button'),
      b => [b.dataset.key.slice(5), b.getAttribute('aria-pressed')])),
    modeTexts: Array.from(document.querySelectorAll('.mode-buttons button'), b => b.textContent),
    card: (document.querySelector('.card-buttons [aria-pressed="true"]') || {}).id || null,
    chainCaption: document.querySelector('#chain-map caption').textContent,
    candidatesShown: shown(document.querySelector('#candidates')),
    candidates: Array.from(document.querySelectorAll('#candidates .cand-button'), b => ({id: b.dataset.key.slice(5),
      pressed: b.getAttribute('aria-pressed'), title: b.querySelector('.cand-title').textContent,
      effect: shownText(b.querySelector('.cand-effect')), read: hiddenText(b.querySelector('.cand-effect')),
      marks: b.querySelectorAll('.cand-effect [aria-hidden="true"]').length})),
    reason: shown(document.querySelector('#candidates-none')) ? document.querySelector('#candidates-none').textContent : null,
    reasonLive: (live => (live ? [live.getAttribute('role'), live.getAttribute('aria-live')] : null))(
      document.querySelector('#candidates-none').closest('[role="status"]')),
    ranking: document.querySelector('#ranking-text').textContent,
    select: {value: select.value, font: getComputedStyle(select).fontSize,
      label: (document.querySelector('label[for="choose-move"]') || {}).textContent,
      first: select.options.length ? [select.options[0].value, select.options[0].textContent, select.options[0].parentElement.tagName,
        select.options[0].disabled] : null,
      chosen: select.selectedIndex >= 0 ? select.options[select.selectedIndex].textContent : null,
      groups: Array.from(select.querySelectorAll('optgroup'), g => [g.label, Array.from(g.children, o => [o.value, o.textContent])])},
    noMove: shown(document.querySelector('#no-move')) ? document.querySelector('#no-move').textContent : null,
    result: shown(document.querySelector('#compare-result')),
    heading: heading.textContent, headingTag: heading.tagName, headingTabindex: heading.getAttribute('tabindex'),
    summary: Array.from(summary.querySelectorAll('p'), p => p.textContent),
    summaryLive: [summary.getAttribute('role'), summary.getAttribute('aria-live')],
    attackHeads: Array.from(document.querySelectorAll('#attack-area thead th'), th => th.textContent),
    attack: body('#attack-area').map(tr => ({head: shownText(tr.querySelector('th')), read: hiddenText(tr.querySelector('th')),
      selected: tr.classList.contains('selected'), cells: Array.from(tr.querySelectorAll('td'), shownText)})),
    attackNone: (document.querySelector('#attack-area .attack-none') || {}).textContent || null,
    attackLegend: shown(document.querySelector('#attack-area .attack-legend')),
    names: {shown: shown(document.querySelector('#attack-names')), open: document.querySelector('#attack-names').open,
      rows: body('#attack-names-table').map(tr => Array.from(tr.children, value))},
    lockOne: Array.from(document.querySelectorAll('#lock-one li'), li => li.textContent),
    lockTwo: Array.from(document.querySelectorAll('#lock-two li'), li => li.textContent),
    lockChanges: {hidden: document.querySelector('#lock-changes').hidden, open: document.querySelector('#lock-changes').open,
      heads: Array.from(document.querySelectorAll('#lock-changes-table thead th'), th => th.textContent),
      rows: body('#lock-changes-table').map(tr => Array.from(tr.children, value))},
    notes: Array.from(document.querySelectorAll('#move-notes p'), p => p.textContent),
    same: {caption: (document.querySelector('#same-table caption') || {}).textContent || null,
      heads: Array.from(document.querySelectorAll('#same-table thead th'), th => th.textContent),
      rows: body('#same-table').map(tr => { const b = tr.querySelector('button');
        return {id: b.dataset.key.slice(5), pressed: b.getAttribute('aria-pressed'), selected: tr.classList.contains('selected'),
          cells: Array.from(tr.children, value)}; })}
  };
}"""
AFTER_STATE = """() => {
  const shownText = """ + SHOWN + """;
  const details = document.querySelector('#after-map'), svg = document.querySelector('#after-figure svg');
  return {open: details.open, hidden: details.hidden,
    phases: Object.fromEntries(Array.from(document.querySelectorAll('.phase-buttons button'),
      b => [b.dataset.key.slice(6), b.getAttribute('aria-pressed')])),
    mapCard: document.querySelector('#map-card').textContent,
    caption: (document.querySelector('#after-map-table caption') || {}).textContent || null,
    rows: Array.from(document.querySelectorAll('#after-map-table tbody tr'), tr => { const b = tr.querySelector('th button');
      return {id: b.dataset.key.slice('after-acct:'.length), pressed: b.getAttribute('aria-pressed'), tabindex: b.getAttribute('tabindex'),
        cell: shownText(tr.querySelector('.result-cell')),
        sr: Array.from(tr.querySelectorAll('.result-cell .visually-hidden'), n => n.textContent).join(' '),
        tags: Array.from(tr.querySelectorAll('.changed-tag')).filter(li => li.getClientRects().length).map(li => li.textContent)}; }),
    svg: svg ? {title: svg.querySelector(':scope > title').textContent,
      changes: Array.from(svg.querySelectorAll('.map-change'), g => [g.dataset.row, g.querySelector('text').textContent]),
      rows: Array.from(svg.querySelectorAll('.map-row'), g => g.dataset.row),
      fallen: Array.from(svg.querySelectorAll('.map-item'))
        .filter(g => g.querySelector('.map-box, .map-card').classList.contains('fallen')).map(g => g.dataset.node)} : null,
    text: details.textContent};
}"""
# The span from the top of the comparison heading to the bottom of the last summary line
W3_SPAN = """() => { const h = document.querySelector('#compare-heading').getBoundingClientRect();
  const lines = document.querySelectorAll('#compare-summary p'); const last = lines[lines.length - 1].getBoundingClientRect();
  return {top: h.top, bottom: last.bottom, span: last.bottom - h.top}; }"""
# The text of the panel of tab 3 in every form (shown or hidden, the stacked headings, the option labels, the diagram's title)
COMPARE_TEXT = """() => { const panel = document.querySelector('#panel-compare');
  return [panel.textContent, ...Array.from(panel.querySelectorAll('[data-label]'), el => el.dataset.label),
    ...Array.from(panel.querySelectorAll('optgroup'), g => g.label),
    ...Array.from(panel.querySelectorAll('[aria-label]'), el => el.getAttribute('aria-label'))].join(' '); }"""


def move_of(k, move_id):
    return next(m for m in k["vectors"]["moves"] if m["id"] == move_id)


def account_head(title, language):
    """The change sentence without its account at the head (the text of the option in the select)."""
    return title.split("：", 1)[1] if language == "ja" else title.split(": ", 1)[1]


def expected_attack(k, mv, mode, language, wide):
    """The attack table (four cards and the total, summed over the cards) from the known vectors: before and after are
    counts; saved and newly fallen are full names on wide screens and counts on narrow ones."""
    rows, sums = [], [0, 0, 0, 0]
    names = lambda ids: LIST_SEPARATOR[language].join(k["full"][language][s] for s in ids) if ids else CELL_NONE[language]
    for index, card in enumerate(CARDS):
        before = len(k["vectors"]["cards"][card]["services"])
        saved, exposed = mv["cards"][card]["saved"], mv["cards"][card]["exposed"]
        after = before - len(saved) + len(exposed)
        sums = [sums[0] + before, sums[1] + after, sums[2] + len(saved), sums[3] + len(exposed)]
        cells = [str(before), str(after)] + ([names(saved), names(exposed)] if wide else [str(len(saved)), str(len(exposed))])
        head = CARD_NAMES[language][card] if wide else FOUR_HEADS[language][index][0]
        rows.append({"head": head, "selected": card == mode, "cells": cells})
    # The mark of the selected card is on the row of the mode's card only: the total is not a card (no row in that mode)
    rows.append({"head": ATTACK_TOTAL[language], "selected": False, "cells": [str(n) for n in sums]})
    return rows


def expected_after(k, mv, card):
    """The accounts that fall to the card after the change: those that fell before, less the saved, plus the newly fallen."""
    before = k["vectors"]["cards"][card]["services"]
    saved, exposed = mv["cards"][card]["saved"], mv["cards"][card]["exposed"]
    return [s for s in k["services"] if (s in before and s not in saved) or s in exposed]


def expected_lock_changes(k, mv):
    """The accounts whose lockout cells (mark and partners) differ before and after the change."""
    usual, after = k["vectors"]["lossTable"], mv["lossTable"]
    return [s for s in k["services"] if any(usual["cells"][c][s] != after["cells"][c][s] for c in usual["columns"])]


def mail_head(k, language):
    mail = next(loss for loss in k["person"]["losses"] if loss["id"] == "mail")["lost"][0]
    return k["short"][language][mail]


def lock_text(k, cell, language):
    """A cell of a lockout table from the known vectors (its mark and its partners), written out: ○, ×, 消 (gone), or ○ with
    the partners whose loss as well locks the owner out."""
    if cell["mark"] != "ok" or not cell["plus"]:
        return LOCK_MARKS[language][cell["mark"]]

    def partner(loss):
        if loss != "mail":
            return PARTNERS[language][loss]
        short = mail_head(k, language)
        return short if language == "ja" else "the " + (short[0].lower() + short[1:] if re.match(r"[A-Z](?![A-Z])", short) else short)
    names = [partner(loss) for loss in cell["plus"]]
    verb = "go" if cell["plus"][-1] == "paper" else "goes"
    one, two = PLUS_TEXT[language]
    if len(names) == 1:
        return one.format(p=names[0], verb=verb)
    return two.format(p1=LIST_SEPARATOR[language].join(names[:-1]), p2=names[-1], verb=verb)


def assert_compare(page, k, pid, mode, move, card, width, language, name):
    """Tab 3 for one person, mode and change: the modes, the candidates of the spec, the select, the summary, the attack
    table, the lockout lines and table before and after, and the same-entrance table, against the known vectors."""
    state = page.evaluate(COMPARE_STATE)
    wide = width >= 720
    check(state["modes"] == {m: str(m == mode).lower() for m in MODES}, (name, "mode buttons", state["modes"]))
    check(state["modeTexts"] == list(MODE_LABELS[language]), (name, "mode names", state["modeTexts"]))
    check(state["card"] == "card-" + card, (name, "the card of the map", state["card"]))
    check(state["ranking"] == RANKING_TEXT[language][mode == "lockout"], (name, "ranking note", state["ranking"]))
    expected = CANDIDATES[pid][mode]
    if isinstance(expected, str):
        check(not state["candidatesShown"] and not state["candidates"], (name, "no candidates", state["candidates"]))
        check(state["reason"] == REASONS[expected][language].format(person=PERSON_LABELS[language][PEOPLE.index(pid)]),
              (name, "reason", state["reason"]))
        # The reason is a status message: it is shown inside a live region (read without moving the focus)
        check(state["reasonLive"] == ["status", "polite"], (name, "the reason in a live region", state["reasonLive"]))
        # The placeholder comes first and cannot be chosen again once a change is chosen
        check(state["select"]["first"] == ["", CHOOSE[language][1], "SELECT", True], (name, "placeholder first", state["select"]["first"]))
    else:
        check(state["reason"] is None, (name, "no reason", state["reason"]))
        check([c["id"] for c in state["candidates"]] == [c[0] for c in expected], (name, "candidates", [c["id"] for c in state["candidates"]]))
        check(state["candidates"][0]["id"] == k["vectors"]["best"][mode], (name, "the suggestion first"))
        for candidate, (_, effect_ja, effect_en) in zip(state["candidates"], expected):
            effect = effect_ja if language == "ja" else effect_en
            check(candidate["effect"] == effect, (name, "effect line", candidate["effect"], effect))
            # ★ and × are hidden from screen readers, and a word is read for each
            check(candidate["marks"] == effect.count("★") + effect.count("×"), (name, "marks", candidate))
            check(candidate["read"].count("重要" if language == "ja" else "Important") == effect.count("★"), (name, "★ read", candidate))
            check(candidate["pressed"] == str(candidate["id"] == move).lower(), (name, "pressed candidate", candidate))
            check(candidate["title"] and candidate["title"].startswith(k["full"][language][move_of(k, candidate["id"])["service"]]),
                  (name, "candidate title", candidate["title"]))
        check(state["select"]["first"][0] != "", (name, "no placeholder when there are candidates", state["select"]["first"]))
    # The select: one group per account (data order, full name), every change of the person in the order of the list
    moves = k["vectors"]["moves"]
    groups = [[k["full"][language][s], [m["id"] for m in moves if m["service"] == s]] for s in k["services"]]
    got = [[label, [value for value, _ in options]] for label, options in state["select"]["groups"]]
    check(got == [g for g in groups if g[1]], (name, "select groups"))
    for label, options in state["select"]["groups"]:
        check(all(text and not text.startswith(label) for _, text in options), (name, "an option leaves out the account", label))
    check(state["select"]["font"] == "16px" and state["select"]["label"] == CHOOSE[language][0], (name, "select", state["select"]["font"]))
    check(state["select"]["value"] == (move or ""), (name, "select value", state["select"]["value"], move))
    if move is None:
        check(state["noMove"] == NO_MOVE[language] and not state["result"], (name, "no change chosen", state["noMove"]))
        return state
    check(state["noMove"] is None and state["result"], (name, "the comparison is shown"))
    mv = move_of(k, move)
    check(state["headingTag"] == "H3" and state["headingTabindex"] == "-1", (name, "comparison heading", state["headingTag"]))
    title = KNOWN_TITLES.get((pid, move), {}).get(language)
    check(state["heading"] == title if title else bool(state["heading"]), (name, "comparison heading text", state["heading"]))
    check(state["select"]["chosen"] == account_head(state["heading"], language), (name, "the option shown", state["select"]["chosen"]))
    check(state["summaryLive"] == ["status", "polite"], (name, "summary live region", state["summaryLive"]))
    summary = KNOWN_SUMMARIES.get((pid, move), {}).get(language)
    check(state["summary"] == summary if summary else len(state["summary"]) >= 2, (name, "summary", state["summary"]))
    # Attack (four cards)
    changed = any(mv["cards"][c]["saved"] or mv["cards"][c]["exposed"] for c in CARDS)
    if changed:
        check(state["attackHeads"] == list(ATTACK_HEADS[language]), (name, "attack headings", state["attackHeads"]))
        attack = expected_attack(k, mv, mode, language, wide)
        got = [{"head": r["head"], "selected": r["selected"], "cells": r["cells"]} for r in state["attack"]]
        check(got == attack, (name, "attack table", got, attack))
        for row in state["attack"]:
            check((ATTACK_MODE[language] in row["read"]) == row["selected"], (name, "the selected card is read", row))
        check(state["attackLegend"] == (not wide), (name, "short card names explained on narrow screens"))
        check(state["names"]["shown"] == (not wide), (name, "the names box only on narrow screens", state["names"]))
    else:
        check(state["attackNone"] == ATTACK_NONE[language] and not state["attack"], (name, "no attack table", state["attackNone"]))
    # Lockout: one loss and two at once (one line at least; "no change" when nothing changes)
    lost = any(x["newlyLocked"] or x["unlocked"] for x in mv["losses"].values())
    check(state["lockOne"] and (state["lockOne"] != [LOCK_NONE[language]]) == lost, (name, "one loss", state["lockOne"]))
    pairs = any(x["newlyLocked"] or x["unlocked"] for x in mv["pairLosses"].values())
    check(state["lockTwo"] and (state["lockTwo"] != [PAIR_NONE[language]] or not pairs), (name, "two at once", state["lockTwo"]))
    accounts = expected_lock_changes(k, mv)
    check(state["lockChanges"]["hidden"] == (not accounts), (name, "lockout table before and after", accounts))
    # Notes
    notes = KNOWN_NOTES.get((pid, move))
    if notes:
        check(state["notes"] == [NOTES[key][language] for key in notes], (name, "notes", state["notes"]))
    # The same-entrance table: every change to the same entrance, in the order of the list
    same = [m for m in moves if m["service"] == mv["service"] and m["method"] == mv["method"]]
    check([r["id"] for r in state["same"]["rows"]] == [m["id"] for m in same], (name, "same-entrance rows"))
    check(state["same"]["heads"] == list(SAME_HEADS[language]), (name, "same-entrance headings", state["same"]["heads"]))
    for row, m in zip(state["same"]["rows"], same):
        check(row["pressed"] == str(m["id"] == move).lower() and row["selected"] == (m["id"] == move), (name, "same pressed", row))
        sums = [str(sum(len(m["cards"][c][field]) for c in CARDS)) for field in ("saved", "exposed")]
        check(row["cells"][1:3] == sums, (name, "same-entrance sums", row["cells"], sums))
        unchanged = not any(x["newlyLocked"] or x["unlocked"] for x in m["losses"].values())
        check((row["cells"][3] == CELL_NONE[language]) == unchanged, (name, "same-entrance lockout", row["cells"]))
    return state


def assert_lock_changes(page, k, pid, move, language, name):
    """The lockout table before and after (its box opened): the accounts whose cells change, each loss before and after."""
    state = page.evaluate(COMPARE_STATE)["lockChanges"]
    mv = move_of(k, move)
    accounts = expected_lock_changes(k, mv)
    heads = [*LOCK_HEADS[language], mail_head(k, language)]
    phases = (ATTACK_HEADS[language][1], ATTACK_HEADS[language][2])
    check(state["heads"] == [COL_ACCOUNT[language]] + [LOCK_PHASE[language].format(loss=h, phase=p) for h in heads for p in phases],
          (name, "before and after headings", state["heads"]))
    check([row[0] for row in state["rows"]] == [("★" if s in k["important"] else "") + k["full"][language][s] for s in accounts],
          (name, "the accounts that change", state["rows"]))
    usual, after = k["vectors"]["lossTable"], mv["lossTable"]
    for row, account in zip(state["rows"], accounts):
        cells = []
        for column in usual["columns"]:
            cells += [usual["cells"][column][account], after["cells"][column][account]]
        # The whole row: the name, then the six cells (the three losses, before and after), each written out
        expected = [lock_text(k, cell, language) for cell in cells]
        check(row[1:] == expected, (name, account, "cells before and after", row[1:], expected))


def assert_after_map(page, k, pid, move, card, width, language, name, results):
    """The map after the change (its box opened): always the last step (the caption and the rows of "this step"); the accounts
    that fall to the card after the change (from the known vectors), the known rows of the spec (step, entrance used,
    backdoor), the changed entrance marked, and the diagram at its natural size on wide screens."""
    state = page.evaluate(AFTER_STATE)
    mv = move_of(k, move)
    check(state["open"] and not state["hidden"], (name, "the map box is open"))
    check(state["phases"] == {"before": "false", "after": "true"}, (name, "after the change", state["phases"]))
    check(state["mapCard"] == MAP_CARD[language].format(card=CARD_NAMES[language][card]), (name, "card of the map", state["mapCard"]))
    fallen = [row["id"] for row in state["rows"] if row["cell"].startswith("●")]
    check(fallen == expected_after(k, mv, card), (name, "the accounts that fall after the change", fallen))
    check([row["id"] for row in state["rows"]] == k["services"], (name, "rows of the map after"))
    check(all(row["tabindex"] is None for row in state["rows"]), (name, "names stay in the Tab order"))
    removed = mv["kind"] == "remove"
    changed_key = mv["service"] + "." + mv["method"]
    tags = {row["id"]: row["tags"] for row in state["rows"] if row["tags"]}
    check(tags == ({} if removed else {mv["service"]: [CHANGED_TAG[language]]}), (name, "the changed entrance in the table", tags))
    for word in ("（仮）", "(provisional)", "この口座だけの系統", "Own family ("):
        check(word not in state["text"], (name, "not on the screen", word))
    # The map is at its last step: the caption names the highest step in the table (●n), and only the rows of that step say
    # "this step"
    ranks = {row["id"]: int(re.match(r"●(\d+)", row["cell"]).group(1)) for row in state["rows"] if row["cell"].startswith("●")}
    top = max(ranks.values(), default=0)
    check(state["caption"] == caption_of(pid, card, top, language), (name, "caption after the change", state["caption"], top))
    this_step = [row["id"] for row in state["rows"] if row["cell"].endswith(CELL_THIS_STEP[language])]
    check(this_step == [account for account, n in ranks.items() if n == top], (name, "this step after the change", this_step, ranks))
    # A known row (the spec's D and F): its step, the entrance used (the changed one, by its new name) and the backdoor mark,
    # shown and read; on wide screens the same step and the opened entrance in the diagram
    known_row = AFTER_KNOWN.get((pid, move, card))
    if known_row:
        account, rank, via, backdoor, last = known_row
        row = next(r for r in state["rows"] if r["id"] == account)
        cell = (CELL_FALLEN[language].format(rank=rank, via=via[language]) + (CELL_BACKDOOR[language] if backdoor else "")
                + (CELL_THIS_STEP[language] if rank == last else ""))
        check(row["cell"] == cell, (name, "a known row after the change", row["cell"], cell))
        sr = " ".join([SR_FALLEN[language].format(rank=rank, via=via[language])] + ([SR_BACKDOOR[language]] if backdoor else []))
        check(row["sr"] == sr, (name, "the known row read after the change", row["sr"], sr))
        check(top == last, (name, "the last step after the change", top, last))
        if width >= 720:
            drawn = page.evaluate(SVG_STATE, "#after-figure")
            check(drawn["marks"].get(account) == "●" + str(rank) and [changed_key, OPEN_TAG[language]] in drawn["open"],
                  (name, "the known step and opened entrance in the diagram", drawn["marks"], drawn["open"]))
    if width >= 720:
        metrics = assert_svg(page, width, pid, name, results, "#after-figure")
        svg = state["svg"]
        check(svg["title"] == state["caption"], (name, "diagram title", svg["title"], state["caption"]))
        check(svg["changes"] == ([] if removed else [[changed_key, CHANGED_TAG[language]]]), (name, "changed in the diagram", svg["changes"]))
        check((changed_key in svg["rows"]) == (not removed), (name, "a removed entrance is not drawn after the change"))
        check([n for n in svg["fallen"] if n in k["services"]] == expected_after(k, mv, card), (name, "fallen cards", svg["fallen"]))
        return metrics
    return None


def press_key(page, key):
    """Press the element with this data-key with the keyboard; the focus stays on an element with the same key."""
    page.locator(f'[data-key="{key}"]').focus()
    page.keyboard.press("Enter")
    active = page.evaluate(ACTIVE)
    check(active["key"] == key, ("the focus stays after pressing", key, active))


def test_compare_tab(page, width, layouts, language, known):
    """Tab 3 for the three people and the six modes (the candidates table of the spec), the map after each suggestion,
    the map before a change, the select, the focus after each control, and the full and short names of the attack table."""
    page.locator("#tab-compare").click()
    page.locator("#person-worker").click()
    press_key(page, "mode:all")
    # Opened whatever an earlier check left (a click on the summary of a box left open would close it)
    if not page.locator("#after-map").evaluate("el => el.open"):
        page.locator("#after-map > summary").click()
    check(page.locator("#after-map").evaluate("el => el.open"), "the box of the map after a change is open")
    card = page.evaluate(COMPARE_STATE)["card"][len("card-"):]
    for pid in PEOPLE:
        k = known[pid]
        page.locator("#person-" + pid).click()
        for mode in MODES:
            press_key(page, "mode:" + mode)
            card = mode if mode in CARDS else card
            move = k["vectors"]["best"][mode]
            name = f"{pid}-{mode}"
            assert_compare(page, k, pid, mode, move, card, width, language, name)
            if move is None:
                check(page.locator("#after-map").is_hidden(), (name, "no map without a change"))
                continue
            assert_after_map(page, k, pid, move, card, width, language, name, layouts)
        assert_layout(page, width, pid + "-compare", layouts)
        # The map before the change: the map of tab 1 at the last step, with the changed entrance marked
        press_key(page, "mode:all")
        move = k["vectors"]["best"]["all"]
        press_key(page, "phase:before")
        check(page.locator("#after-map").evaluate("el => el.open"), (pid, "Before keeps the map box open"))
        state = page.evaluate(AFTER_STATE)
        check(state["phases"] == {"before": "true", "after": "false"}, (pid, "before the change", state["phases"]))
        last = last_step(k, card)
        cells = [row["cell"] for row in state["rows"]]
        expected = [expected_cell(k, card, account, last, language) for account in k["services"]]
        check(cells == expected, (pid, "the map before the change is the map at the last step", cells, expected))
        mv = move_of(k, move)
        check({row["id"]: row["tags"] for row in state["rows"] if row["tags"]} == {mv["service"]: [CHANGED_TAG[language]]},
              (pid, "the entrance to change is marked before the change"))
        check(state["caption"] == caption_of(pid, card, last, language), (pid, "caption before the change", state["caption"]))
        if width >= 720:
            assert_svg(page, width, pid, pid + "-before", layouts, "#after-figure")
            assert_svg_state(page, k, pid, card, last, language, pid + "-before", "#after-figure")
        if width < 720:
            for phase in ("before", "after"):
                press_key(page, "phase:" + phase)
                table = page.evaluate(NARROW_TABLE, "#after-map-table")
                check(table["columns"] == 2 and table["width"] <= table["frame"] + 0.5, (pid, phase, "two columns inside the box", table))
                check(not table["split"] and table["minFont"] >= 14, (pid, phase, "words kept whole, 14px", table["split"], table["minFont"]))
                layouts.append({"state": f"{pid}-after-map-{phase}", "table": table})
        press_key(page, "phase:after")
        # A name in the map after the change selects the account and keeps the focus (even on narrow screens)
        press_key(page, "after-acct:" + mv["service"])
        check(page.locator(f'[data-key="after-acct:{mv["service"]}"]').get_attribute("aria-pressed") == "true", (pid, "name pressed"))
        check(page.locator("#tab-compare").get_attribute("aria-selected") == "true", (pid, "still in tab 3"))
    # Candidates, the same-entrance table and the select keep the focus and choose the change
    k = known["worker"]
    page.locator("#person-worker").click()
    press_key(page, "mode:simswap")
    second = CANDIDATES["worker"]["simswap"][1][0]
    press_key(page, "cand:" + second)
    state = assert_compare(page, k, "worker", "simswap", second, "simswap", width, language, "second candidate")
    check(state["candidates"][1]["pressed"] == "true", ("the second candidate is pressed", state["candidates"][1]))
    press_key(page, "same:" + W3_MOVE)
    state = assert_compare(page, k, "worker", "simswap", W3_MOVE, "simswap", width, language, "same-entrance W3")
    caption, rows = W3_SAME[language]
    check(state["same"]["caption"] == caption, ("W3 same-entrance caption", state["same"]["caption"]))
    check([tuple(r["cells"]) for r in state["same"]["rows"]] == list(rows), ("W3 same-entrance rows", state["same"]["rows"]))
    page.locator("#lock-changes > summary").click()
    assert_lock_changes(page, k, "worker", W3_MOVE, language, "W3 lockout before and after")
    page.locator("#lock-changes > summary").click()
    select = page.locator("#choose-move")
    for pid, move, card_name in (("worker", "replace:shop.recMail:mailMain>paper:shop", "simswap"), ("student", STUDENT_SUB, "simswap")):
        page.locator("#person-" + pid).click()
        select.focus()
        select.select_option(move)
        check(page.evaluate(ACTIVE)["id"] == "choose-move", (move, "the focus stays on the select"))
        state = assert_compare(page, known[pid], pid, "simswap", move, "simswap", width, language, "chosen " + move)
        # The map after a change chosen in the select (its box is still open): STUDENT_SUB is a known row of the spec
        assert_after_map(page, known[pid], pid, move, "simswap", width, language, "chosen " + move, layouts)
        # The attack table names accounts in full; the summary uses the short names
        row = next(r for r in state["attack"] if r["head"] == (CARD_NAMES[language]["simswap"] if width >= 720
                                                                  else FOUR_HEADS[language][1][0]))
        full = known[pid]["full"][language]["shop" if pid == "worker" else "sub"]
        if width >= 720:
            check(full in row["cells"][2:], (move, "full name in the attack table", row))
        else:
            page.locator("#attack-names > summary").click()
            names = page.evaluate(COMPARE_STATE)["names"]["rows"]
            check(any(full in cells for cells in names), (move, "full name in the names box", names))
            page.locator("#attack-names > summary").click()
    page.locator("#person-worker").click()
    # In English, nothing Japanese anywhere in tab 3 (shown or hidden text, stacked headings, option labels)
    if language == "en":
        text = page.evaluate(COMPARE_TEXT)
        check(not JAPANESE.search(text), ("Japanese in tab 3", JAPANESE.findall(text)[:10]))
    assert_layout(page, width, "compare-after-focus", layouts)
    if page.locator("#after-map").evaluate("el => el.open"):
        page.locator("#after-map > summary").click()
    page.locator("#tab-chain").click()


# Counts the mutations written into each of the given elements from now on (one MutationObserver per element; the
# observers of an earlier count are disconnected)
LIVE_WATCH = """(selectors) => {
  (window.__qaLiveObservers || []).forEach(o => o.disconnect());
  window.__qaLive = {};
  window.__qaLiveObservers = selectors.map(sel => { window.__qaLive[sel] = 0;
    const o = new MutationObserver(records => { window.__qaLive[sel] += records.length; });
    o.observe(document.querySelector(sel), {childList: true, subtree: true, characterData: true, attributes: true});
    return o; });
}"""
LIVE_COUNT = "() => ({...window.__qaLive})"


def test_compare_updates(page, width, language, known, results):
    """Tab 3 keeps what is read in step with the choices. The summary (a live region) is written for every change chosen,
    even when its sentences stay the same (W2's change to paper codes and the removal of the same entrance read alike),
    and is left alone by a redraw that keeps the change (the tab pressed again, a mode with the same suggestion, the map
    before or after). The reason shown without candidates is written once into its live region. Pressing the card mode
    already chosen sets the card of the map again after the card was changed in tab 1, and keeps the change. Leaves the
    parent with the SIM-swap mode (P3's change) in tab 1."""
    k = known["worker"]
    watched = ["#compare-summary", "#candidates-status"]
    page.locator("#person-worker").click()
    page.locator("#tab-compare").click()
    press_key(page, "mode:all")
    removal = "remove:mailMain.recMail"
    w2_summary = KNOWN_SUMMARIES[("worker", W2_MOVE)][language]
    for key, move in (("same:" + removal, removal), ("same:" + W2_MOVE, W2_MOVE), ("cand:" + W2_MOVE, W2_MOVE)):
        page.evaluate(LIVE_WATCH, watched)
        press_key(page, key)
        state, counts = page.evaluate(COMPARE_STATE), page.evaluate(LIVE_COUNT)
        check(state["select"]["value"] == move and state["summary"] == w2_summary, (key, "the change and its summary", state["summary"]))
        check(counts["#compare-summary"] >= 1, (key, "the summary is written for every change chosen, even with the same sentences", counts))
    # A redraw that keeps the change: the tab pressed again, the map before and after, a mode with the same suggestion
    page.evaluate(LIVE_WATCH, watched)
    page.locator("#tab-compare").click()
    page.locator("#after-map > summary").click()
    press_key(page, "phase:before")
    press_key(page, "phase:after")
    page.locator("#after-map > summary").click()
    press_key(page, "mode:mail")
    check(k["vectors"]["best"]["mail"] == W2_MOVE and page.evaluate(COMPARE_STATE)["select"]["value"] == W2_MOVE, "the same suggestion")
    counts = page.evaluate(LIVE_COUNT)
    check(counts == {"#compare-summary": 0, "#candidates-status": 0}, ("nothing is read again by a redraw", counts))
    # The card mode already chosen sets the card of the map again (at its last step) after tab 1 changed the card and its
    # step, empties the status of the step (without a word), and keeps the change chosen in that mode: the second candidate,
    # not the suggestion (a mode that went back to its suggestion would look the same with the suggestion chosen)
    press_key(page, "mode:leak")
    leak_move = CANDIDATES["worker"]["leak"][1][0]
    check(leak_move != k["vectors"]["best"]["leak"], ("the change kept is not the suggestion", leak_move))
    press_key(page, "cand:" + leak_move)
    page.locator("#tab-chain").click()
    page.locator("#card-mail").click()
    press(page, "#step-first")
    page.locator("#tab-compare").click()
    check(page.evaluate(COMPARE_STATE)["card"] == "card-mail", "tab 1 changed the card")
    press_key(page, "mode:leak")
    state = page.evaluate(COMPARE_STATE)
    check(state["card"] == "card-leak" and state["modes"]["leak"] == "true", ("pressing the mode again sets the card", state["card"]))
    check(state["chainCaption"] == caption_of("worker", "leak", last_step(k, "leak"), language), ("the card at its last step", state["chainCaption"]))
    check(page.locator("#map-card").text_content() == MAP_CARD[language].format(card=CARD_NAMES[language]["leak"]),
          ("the card of the map", page.locator("#map-card").text_content()))
    check(state["select"]["value"] == leak_move, ("pressing the mode again keeps the change", state["select"]["value"]))
    status = page.evaluate("() => document.querySelector('#step-status').textContent")
    check(status == "", ("a card changed by the mode empties the step status", status))
    # The reason without candidates (the student's help desk): written once into its live region, not again by a redraw
    page.locator("#person-student").click()
    page.evaluate(LIVE_WATCH, watched)
    press_key(page, "mode:desk")
    state, counts = page.evaluate(COMPARE_STATE), page.evaluate(LIVE_COUNT)
    check(state["reason"] == REASONS["noFall"][language] and counts["#candidates-status"] >= 1, ("the reason is written", state["reason"], counts))
    page.evaluate(LIVE_WATCH, watched)
    page.locator("#tab-compare").click()
    press_key(page, "mode:desk")
    counts = page.evaluate(LIVE_COUNT)
    check(counts["#candidates-status"] == 0, ("the same reason is not written again", counts))
    page.locator("#person-parent").click()
    press_key(page, "mode:simswap")
    page.locator("#tab-chain").click()
    results.append({"state": f"compare-updates-{width}-{language}"})


# The changes the owner chose after the student-role review (2026-10-30): the hint at the last step, the entrances under
# the lockout table, the note on removals under the same-entrance table and the button back to the comparison
STEP_HINT = {"ja": "「最初から」を押すと、段0から1段ずつ追えます。",
             "en": "Press “Start over” to follow the chain one step at a time from step 0."}
LOCK_ENTRANCES = {
    "bank": {"ja": "銀行のネットバンキングの入口：ログイン：黄A＋SMS／復旧：SMS",
             "en": "Online banking: Log-in: Yellow A + SMS / Recovery: SMS"},
    "msg": {"ja": "メッセージアプリ（家族との連絡）の入口：ログイン：スマホ／復旧：SMS＋黄A",
            "en": "Messaging app (family chats): Log-in: Phone / Recovery: SMS + Yellow A"},
}
BACK_TO_COMPARE = {"ja": "比べた結果へ戻る", "en": "Back to the comparison"}


def test_owner_decisions(page, width, language, known, results):
    """Tab 1: at the last step (where another card or person starts) a hint tells how to follow the chain from step 0; not
    at step 0, not before the last step, and not when nothing falls (the last step is step 0). Tab 2: under the lockout
    table, the entrances of the account chosen (P2's bank), changed by another name; the hint and the entrances follow a
    language change; below 720px no word of that line is split. Tab 3: the note on removals goes under the same-entrance
    table when the table has a removal other than the change chosen (P3), and not for the removal itself (W3, whose note is
    above the table); after a change pressed in that table (the focus stays on it), the button under the table brings the
    comparison heading to the top of the viewport with the focus; a mode without any change empties the note.
    Leaves the parent with the SIM-swap mode (P3's change) in tab 1."""
    hint = page.locator("#step-hint")
    page.locator("#tab-chain").click()
    for pid in PEOPLE:
        page.locator("#person-" + pid).click()
        for card in CARDS:
            # Another card first: changing the card starts it at its last step, whatever step an earlier check left
            page.locator("#card-" + (CARDS[1] if card == CARDS[0] else CARDS[0])).click()
            page.locator("#card-" + card).click()
            last = last_step(known[pid], card)
            caption = page.locator("#chain-map caption").text_content()
            check(caption == caption_of(pid, card, last, language), (pid, card, "starts at the last step", caption))
            shown = hint.is_visible()
            check(shown == (last > 0), (pid, card, "the hint at the last step only when something falls", last, shown))
            if shown:
                check(hint.text_content() == STEP_HINT[language], (pid, card, "the hint", hint.text_content()))
                press(page, "#step-first")
                check(not hint.is_visible(), (pid, card, "no hint at step 0"))
                if last > 1:
                    press(page, "#step-next")
                    check(not hint.is_visible(), (pid, card, "no hint before the last step"))
                press(page, "#step-last")
                check(hint.is_visible(), (pid, card, "the hint again at the last step"))
    # Tab 2: the entrances of the account chosen, under the lockout table
    page.locator("#person-parent").click()
    page.locator("#tab-lockout").click()
    line = page.locator("#lock-entrances")
    for account in ("bank", "msg", "bank"):
        page.locator(f'[data-key="lock-acct:{account}"]').click()
        check(line.text_content() == LOCK_ENTRANCES[account][language], (account, "the entrances under the lockout table", line.text_content()))
    # The hint (tab 1 is at the last step of the parent's card) and the entrances follow a language change at once
    other = "en" if language == "ja" else "ja"
    page.locator("#language").click()
    check(hint.text_content() == STEP_HINT[other] and line.text_content() == LOCK_ENTRANCES["bank"][other],
          ("the hint and the entrances in the other language", hint.text_content(), line.text_content()))
    page.locator("#language").click()
    if width < 720:
        for pid in PEOPLE:
            page.locator("#person-" + pid).click()
            for key in page.evaluate("() => Array.from(document.querySelectorAll('#lock-map tbody th button'), b => b.dataset.key)"):
                page.locator(f'[data-key="{key}"]').click()
                split = page.evaluate(TEXT_SPLITS, ["#lock-entrances"])
                check(not any(split.values()), (pid, key, "the entrances under the lockout table split a word", split))
    # Tab 3: the note on removals under the same-entrance table (P3), not for the removal itself (W3)
    note = page.locator("#same-note")
    page.locator("#person-parent").click()
    page.locator("#tab-compare").click()
    press_key(page, "mode:simswap")
    check(page.evaluate(COMPARE_STATE)["select"]["value"] == P3_MOVE, "P3 is the parent's suggestion for the SIM swap")
    check(note.is_visible() and note.text_content() == NOTES["remove"][language], ("P3: the note under the table", note.text_content()))
    check(NOTES["remove"][language] not in page.evaluate(COMPARE_STATE)["notes"], "P3: no note on removals above the table")
    page.locator("#person-worker").click()
    page.locator("#choose-move").select_option(W3_MOVE)
    check(not note.is_visible() and note.text_content() == "", ("W3: no note under the table", note.text_content()))
    check(NOTES["remove"][language] in page.evaluate(COMPARE_STATE)["notes"], "W3: the note on removals above the table")
    # Back to the comparison: a change pressed in the same-entrance table keeps the focus; the button brings it to the heading
    press_key(page, "same:replace:sec.recMailSms:phone>idcheck")
    back = page.locator("#back-to-compare")
    check(back.text_content() == BACK_TO_COMPARE[language], ("the button back to the comparison", back.text_content()))
    check(note.is_visible(), "the note under the table once the removal is not the change chosen")
    back.focus()
    page.keyboard.press("Enter")
    heading = page.locator("#compare-heading")
    check(heading.evaluate("el => el === document.activeElement"), ("focus on the comparison heading", page.evaluate(ACTIVE)))
    view = heading.evaluate(IN_VIEW)
    check(view["inside"], ("the comparison heading is in the viewport", view))
    # scrollIntoView brings the heading to the top (the focus alone would leave it lower on the screen)
    check(abs(view["top"]) <= 1, ("the comparison heading at the top of the viewport", view))
    # A mode without any change (the office worker's fewer lockouts) empties the note under the same-entrance table too
    press_key(page, "mode:lockout")
    check(note.evaluate("el => el.hidden") and note.text_content() == "", ("no change: the note is emptied", note.text_content()))
    page.locator("#person-parent").click()
    press_key(page, "mode:simswap")
    page.locator("#tab-chain").click()
    results.append({"state": f"owner-decisions-{width}-{language}"})


def test_compare_highlights(page, width, language, known, results):
    """W2, W3, P3 by keyboard only: the state they set, the comparison heading in the viewport with the focus, the known
    values, then Tab and Shift+Tab; at 320px, W3's heading and summary fit in 640px."""
    for hid, pid, position, move, mode in HIGHLIGHTS_1C:
        k = known[pid]
        page.locator("#person-" + pid).focus()
        page.keyboard.press("Enter")
        # Another mode, change and card than the highlight sets, so that a highlight that leaves one of them alone fails below
        page.locator("#tab-compare").click()
        page.locator(f'[data-key="mode:{"all" if mode != "all" else "simswap"}"]').click()
        page.locator("#tab-chain").click()
        page.locator("#card-desk").click()
        before = page.evaluate(COMPARE_STATE)
        check(before["select"]["value"] != move and before["modes"][mode] == "false" and before["card"] != "card-" + mode,
              (hid, "the state before the highlight differs from its result", before["modes"], before["select"]["value"], before["card"]))
        page.locator("#person-" + pid).focus()
        tab_until(page, lambda active: active["id"].startswith("tab-"), 6)
        page.keyboard.press("Home")
        page.keyboard.press("Tab")
        check(page.evaluate(ACTIVE)["id"] == "panel-chain", (hid, "the panel of the chain tab"))
        tab_to(page, "hl:" + hid, 8)
        check(page.evaluate(CHAIN_STATE)["highlights"][position] == hid, (hid, "position among the person's highlights"))
        page.keyboard.press("Enter")
        heading = page.locator("#compare-heading")
        check(heading.evaluate("el => el === document.activeElement"), (hid, "focus on the comparison heading", page.evaluate(ACTIVE)))
        view = heading.evaluate(IN_VIEW)
        check(view["inside"], (hid, "the heading is in the viewport", view))
        check(page.locator("#tab-compare").get_attribute("aria-selected") == "true", (hid, "tab 3"))
        check(page.locator("#person-status").text_content()
              == STATUS_HIGHLIGHT[language].format(title=HIGHLIGHT_TITLES[hid][language]), (hid, "highlight status"))
        card = mode if mode in CARDS else before["card"][len("card-"):]
        state = assert_compare(page, k, pid, mode, move, card, width, language, hid)
        if card != before["card"][len("card-"):]:
            check(state["chainCaption"] == caption_of(pid, card, last_step(k, card), language), (hid, "a new card at its last step"))
        check(state["summary"] == KNOWN_SUMMARIES[(pid, move)][language], (hid, "summary", state["summary"]))
        check(state["notes"] == [NOTES[key][language] for key in KNOWN_NOTES[(pid, move)]], (hid, "notes", state["notes"]))
        if hid == "W2":
            mail, desk = (next(r for r in state["attack"] if r["head"] == h) for h in (
                (CARD_NAMES[language]["mail"], CARD_NAMES[language]["desk"]) if width >= 720 else
                (FOUR_HEADS[language][2][0], FOUR_HEADS[language][3][0])))
            if width < 720:
                check(mail["cells"][2] == "6" and desk["cells"][2] == "6", (hid, "6 saved for each of two cards", mail, desk))
            check(state["candidates"][0]["effect"] == CANDIDATES["worker"]["all"][0][1 if language == "ja" else 2], (hid, "12 saved"))
            check(state["lockOne"] == [LOCK_NONE[language]] and state["lockTwo"] == [PAIR_NONE[language]], (hid, "no lockout change"))
        if hid == "W3":
            caption, rows = W3_SAME[language]
            check([tuple(r["cells"]) for r in state["same"]["rows"]] == list(rows), (hid, "same-entrance rows"))
            if width == 320:
                span = page.evaluate(W3_SPAN)
                check(span["span"] <= 640, (hid, "heading to the end of the summary within 640px", span))
                results.append({"state": "W3-span", "span": span})
        if hid == "P3":
            removal = next(r for r in state["same"]["rows"] if r["id"] == "remove:bank.recSms")
            check(removal["cells"][1] == "1" and removal["cells"][3] == CELL_NONE[language], (hid, "removing keeps the × of the number"))
            check(page.evaluate(COMPARE_STATE)["lockChanges"]["hidden"] is False, (hid, "the bank's cells change"))
        check(heading.get_attribute("tabindex") == "-1", (hid, "the heading takes the focus by script only"))
        # Tab and Shift+Tab move to the elements after and before the heading.
        handle = heading.element_handle()
        heading.focus()
        page.keyboard.press("Tab")
        after = page.evaluate_handle("() => document.activeElement")
        check(page.evaluate(ORDER, [handle, after]), (hid, "Tab moves forward", page.evaluate(ACTIVE)))
        heading.focus()
        page.keyboard.press("Shift+Tab")
        back = page.evaluate_handle("() => document.activeElement")
        check(page.evaluate(ORDER, [back, handle]), (hid, "Shift+Tab moves back", page.evaluate(ACTIVE)))
    page.locator("#tab-chain").click()


# ===== Stage 1c: tab 4 (rules, symbols, notes, what the model leaves out, paper) and the printed sheets =====
# The rules table of the spec ("規則表（10行）"), the current language only
RULES = {
    "ja": ("アカウントには入口がある。ログインの入口と、復旧（再設定）の入口がある",
           "1つの入口の条件は「かつ」。全部そろえば開く（例：パスワード＋SMSのコード）",
           "入口どうしは「または」。どれか1つ開けば入れる",
           "攻撃者はカードが渡すものから始め、開いたメールも次の条件に使う。新しく開くものがなくなるまで続ける。1回の見直しで開く分を1段と数える",
           "パスワードは系統（色と英字）で表す。同じ系統なら、どのアカウントでも同じものとみなす（少し変えた派生を含む）。漏えいのカードは、"
           "漏れたサービスがいまログインに使っている系統が、IDと組でそのまま（平文で）出回った場合を表す。そのときは、パスワードが長くても、"
           "同じ系統を使う入口ではパスワードの条件がそろう",
           "SMSの条件は電話番号で満たす。攻撃者が持つのはSIMスワップのカードのときだけ",
           "電話の窓口は個人情報で通る。書類での本人確認（身分証・郵送）を破るカードはない",
           "パスキーと認証アプリはスマホの中の鍵として扱う。紙の回復コードは本人の手元にだけある",
           "閉め出し＝本人が失ったもの（1つ、または2つ同時）を外し、手元に残ったものから同じ規則で入れないアカウント。"
           "消えたメールそのものは「消」と表し、閉め出しには数えない。パスワードを忘れることは扱わない",
           "時間・確率・通知・不審なログインの検知は扱わない"),
    "en": ("An account has entrances: log-in entrances and recovery (reset) entrances",
           "All requirements of one entrance must be met (AND), e.g. password + SMS code",
           "Any one entrance is enough (OR)",
           "The attacker starts from what the card gives and uses every opened email for further entrances, until nothing new opens. "
           "Each round of newly opened accounts is one step",
           "Passwords are families (color + letter). The same family counts as the same secret everywhere, small variations included. "
           "A breach card stands for the case where the family that the breached service now uses to log in has leaked as-is "
           "(in plain text), together with the ID; then the password requirement is met on every entrance that uses that family, "
           "however long the password is",
           "An SMS requirement is met by the phone number; the attacker holds it only with the SIM-swap card",
           "A phone help desk accepts personal details; no card defeats a document check (photo ID, postal mail)",
           "Passkeys and authenticator apps are treated as keys inside the phone; paper recovery codes exist only in the owner's hands",
           "Lockout: after removing what the owner lost (one thing, or two at once), the accounts they cannot reach by the same rules from "
           "what remains. A vanished email itself is shown as gone and is not counted as locked out. Forgetting a password is not modeled",
           "Time, probability, notifications and detection of suspicious log-ins are not modeled"),
}
RULE2_EXAMPLE = {
    "ja": "例：会社員のネット銀行の再設定はSMS＋個人情報です。SIMスワップのカード1枚では個人情報がないので倒れません。"
          "線をすべて「または」として数えると、ここで倒れたことになってしまいます。",
    "en": "Example: the office worker's online bank resets with SMS + personal details. The SIM-swap card alone lacks the personal "
          "details, so the bank does not fall. Counting every line as OR would wrongly make it fall here.",
}
RULE5_WORDS = {"ja": "そのまま（平文で）出回った", "en": "leaked as-is"}
RULES_INTRO = {
    "ja": "この画面の結果は、下の規則と、作者が決めた3人の設定から出たものです。実際のサービスの手順は会社ごとに違い、変わることもあります。"
          "実際のサービスは、ここにない仕組み（不審なログインの検知や通知）も持っています。",
    "en": "The results on this page come from the rules below and the settings the author chose for the three people. Real services' "
          "procedures differ from company to company and may change. They also have mechanisms not shown here, such as detecting "
          "suspicious log-ins and sending notifications.",
}
# The symbols table of the spec ("記号の一覧"): headings, then the rows; a blank cell is None
SYMBOL_HEADS = {"ja": ("記号", "何を表すか", "線の種類", "攻撃者が手にするカード", "本人がなくすカード"),
                "en": ("Symbol", "Meaning", "Line type", "Attack card that gives it", "Loss card that takes it")}
SYMBOL_ROWS = {
    "ja": (("赤Aなど", "パスワードの系統", "パスワードの系統", "漏えい（漏れたサービスの系統）", "（扱わない）"),
           ("スマホ", "認証アプリ・パスキー", "多要素", "（なし。端末の感染は模型の外）", "スマホをなくした"),
           ("SMS", "電話番号に届くコード", "SMS", "SIMスワップ", "電話番号を手放した"),
           ("個人情報", "電話の窓口で答える情報", "窓口", "窓口のなりすまし", "（なくさない扱い）"),
           ("書類", "身分証・郵送での本人確認", "窓口", "（なし。偽造は模型の外）", "（なくさない扱い）"),
           ("紙", "紙の回復コード（1手で増える）", "紙の回復コード", "（なし）", "紙をなくした（2つ同時の行と、手のあとの表の「＋紙で×」だけ）"),
           ("メールの名前", "メールのアカウント", "メール",
            "メールの乗っ取り（人ごとに1つ＝会社員は古いメール、親はプロバイダーのメール、学生は大学のメール）", "メールが消えた（同じく人ごとに1つ）"),
           ("ロ／復、＋", "ログインの入口（カタカナのロ）／復旧の入口、かつ（図と印刷で使う。画面の表では「ログイン」「復旧」と書く）", "実線／破線", None, None),
           ("●1・×・消・★", "段1で倒れた・閉め出し・そのメール自体が消えた・重要", None, None, None)),
    "en": (("Red A, etc.", "Password family", "Password family", "Breach (the family the breached service uses)", "(not modeled)"),
           ("Phone", "Authenticator app, passkey", "Multi-factor", "(none; an infected device is outside the model)", "Lost the phone"),
           ("SMS", "Code sent to the phone number", "SMS", "SIM swap", "Gave up the phone number"),
           ("Personal details", "Answers given to a phone help desk", "Help desk", "Help-desk impersonation", "(treated as never lost)"),
           ("Documents", "Identity check with photo ID or postal mail", "Help desk", "(none; forgery is outside the model)",
            "(treated as never lost)"),
           ("Paper codes", "Paper recovery codes (added by a change)", "Paper recovery codes", "(none)",
            "Lost the paper recovery codes (only in two-at-once lines and “× if the paper codes go too” in the after-change table)"),
           ("Email name", "An email account", "Email",
            "Email takeover (one per person: the old email, the ISP email, the university email)", "Email gone (one per person, likewise)"),
           ("Log / Rec, +", "Log-in entrance / recovery entrance, AND (diagram and printed sheets only; tables use the words)",
            "Solid / dashed", None, None),
           ("●1 · × · gone · ★", "Fell at step 1 · locked out · the email itself is gone · important", None, None, None)),
}
# The four notes of the rules tab (the spec's "注記4つ"); the related tools in the fourth open in a new tab
RULE_NOTES = {
    "ja": ("SMSの線は、SIMスワップのカードがあるときだけ攻撃者に開きます。根拠の研究（Leeら、SOUPS 2020。携帯会社を調べたのは2019年）は"
           "米国のプリペイド5社のもので、日本の携帯会社には当てはめません。",
           "パスキーと認証アプリはスマホの中の鍵として扱います。同期したパスキーをクラウドのアカウントの回復で取り出す経路と、"
           "端末の感染で乗っ取る経路は、この模型に入れていません。この模型にはスマホを攻撃者に渡すカードがないので、"
           "スマホを足す手で攻撃の面が悪くなることはありません。「スマホをなくした」の値は、認証アプリやパスキーを、"
           "ほかの端末やクラウドに移していない（同期・バックアップしていない）場合の値です。",
           "電話の窓口は個人情報で通ります。この模型には、書類での本人確認を破るカードも、本人が書類をなくすカードもありません。"
           "このため、書類の確認へ付け替える手で、攻撃と閉め出しが悪くなることはありません。実際には書類は偽造で破られることがあり、"
           "窓口での回復には待ち時間もかかります。実在の本人確認の手順は書きません。",
           "紙の回復コードは本人の手元にだけあります。この模型には紙を攻撃者に渡すカードがないので、紙へ付け替える手で攻撃の面が悪くなることはありません。"
           "実際には置き場所が新しい入口になり、打ち込む場面では偽サイトに強くありません。閉め出しの面では、紙をほかのものと一緒になくすと"
           "入れなくなることがあります。紙を分けて保管するならDay124 Scatter Seeds・Day125 Overlay QR Sharesへ。"),
    "en": ("An SMS line opens for the attacker only with the SIM-swap card. The study behind it (Lee et al., SOUPS 2020; "
           "carrier tests run in 2019) covered five US prepaid carriers and is not applied to Japanese carriers.",
           "Passkeys and authenticator apps are treated as keys inside the phone. Retrieving synced passkeys through cloud-account "
           "recovery, and takeover through an infected device, are outside this model. No card here hands the phone to the attacker, "
           "so adding the phone never makes the attack side worse. The “Lost the phone” values assume the authenticator app and "
           "passkeys are not synced or backed up to another device or the cloud.",
           "A phone help desk accepts personal details. This model has no card that defeats a document check and no card for the "
           "owner losing their documents, so moving a line to a document check never makes the attack or the lockout worse here. "
           "In reality documents can be forged, and recovery at a desk takes time. Real identity-check procedures are not described.",
           "Paper recovery codes exist only in the owner's hands. No card here hands the paper codes to the attacker, so moving a line "
           "to paper codes never makes the attack side worse. In reality, where you keep them becomes a new entrance, and they are not "
           "phishing-resistant when you type them in. On the lockout side, losing the paper codes together with something else can "
           "lock you out. To keep them split across places, see Day124 Scatter Seeds and Day125 Overlay QR Shares."),
}
NOTE_LINKS = (("Day124 Scatter Seeds", "https://ipusiron.github.io/scatter-seeds/"),
              ("Day125 Overlay QR Shares", "https://ipusiron.github.io/overlay-qr-shares/"))
NOT_IN_MODEL = {
    "ja": ("この模型に入れていないもの",
           ("パスワードの強さ", "攻撃の確率・手間・時間", "不審なログインの検知と通知", "同期パスキーをクラウドの回復で取り出す経路", "端末の感染",
            "書類の偽造", "パスワードを忘れること", "SSOとパスワード管理ソフト", "乗っ取ったあとに攻撃者が回復先を書き換えること",
            "漏れたパスワードがハッシュで守られていて解けない場合")),
    "en": ("Not in this model",
           ("Password strength", "Attack probability, effort and time", "Detection of suspicious log-ins and notifications",
            "Retrieving synced passkeys through cloud recovery", "Infected devices", "Forged documents", "Forgetting a password",
            "Single sign-on and password managers", "An attacker changing recovery details after a takeover",
            "Leaks where the passwords are protected by hashing and cannot be cracked")),
}
PAPER = {
    "ja": ("自分の構成は、この画面には入れません。印刷した空欄の用紙に、パスワードを書かずに記号で書きます。用紙には「保管注意（弱点の地図）」の欄があります。",
           "印刷する（3人の地図と空欄の用紙）"),
    "en": ("Your own setup is never entered on this page. Print the blank sheet and fill it in with symbols, without passwords. "
           "The sheet has a “Keep safe (map of weak points)” box.", "Print (three maps and a blank sheet)"),
}
RULES_STATE = """() => {
  const shown = el => !!el && el.getClientRects().length > 0;
  const text = el => el.textContent.replace(/\\s+/g, ' ').trim();
  const rules = document.querySelector('#rules-table'), symbols = document.querySelector('#symbol-table table');
  const fonts = table => Math.min(...Array.from(table.querySelectorAll('th, td, caption')).filter(el => shown(el) && el.textContent.trim())
    .map(el => parseFloat(getComputedStyle(el).fontSize)));
  const frame = el => el.closest('.table-frame').getBoundingClientRect().width;
  const details = document.querySelector('#not-in-model'), heading = document.querySelector('#paper-heading');
  return {
    heading: text(document.querySelector('#panel-rules h2')), intro: text(document.querySelector('#panel-rules h2 + p')),
    noHead: (th => ({hidden: Array.from(th.querySelectorAll('[aria-hidden="true"]'), text),
      spoken: Array.from(th.querySelectorAll('.visually-hidden'), text)}))(rules.querySelector('thead th')),
    rules: {caption: text(rules.querySelector('caption')), heads: Array.from(rules.querySelectorAll('thead th')).filter(shown).map(text),
      rows: Array.from(rules.querySelectorAll('tbody tr'), tr => ({no: text(tr.querySelector('th')), display: getComputedStyle(tr).display,
        rule: text(tr.querySelector('td > [data-i18n="rule2"]') || tr.querySelector('td')),
        example: (e => e ? text(e) : null)(tr.querySelector('.rule-example')),
        exampleBlock: (e => e ? getComputedStyle(e).display : null)(tr.querySelector('.rule-example'))})),
      width: rules.getBoundingClientRect().width, frame: frame(rules), font: fonts(rules)},
    symbols: {caption: text(symbols.querySelector('caption')), heads: Array.from(symbols.querySelectorAll('thead th')).filter(shown).map(text),
      headCount: symbols.querySelectorAll('thead th').length,
      rows: Array.from(symbols.querySelectorAll('tbody tr'), tr => ({display: getComputedStyle(tr).display,
        cells: Array.from(tr.children, cell => ({text: text(cell.querySelector('.cell-value') || cell), label: cell.dataset.label || null,
          shown: shown(cell), heading: (h => (h && shown(h) ? text(h) : null))(cell.querySelector('.cell-label'))}))})),
      width: symbols.getBoundingClientRect().width, frame: frame(symbols), font: fonts(symbols)},
    notes: Array.from(document.querySelectorAll('#rules-notes > li'), li => text(li)),
    links: Array.from(document.querySelectorAll('#panel-rules a'), a => ({text: text(a), href: a.getAttribute('href'),
      target: a.getAttribute('target'), rel: a.getAttribute('rel')})),
    notIn: {summary: text(details.querySelector('summary')), open: details.open,
      items: Array.from(details.querySelectorAll('li'), li => text(li)), shown: Array.from(details.querySelectorAll('li')).filter(shown).length},
    paper: {heading: text(heading), tag: heading.tagName, tabindex: heading.getAttribute('tabindex'),
      intro: text(document.querySelector('#paper-intro')), button: text(document.querySelector('#print-button')),
      describedby: document.querySelector('#print-button').getAttribute('aria-describedby')},
    all: [document.querySelector('#panel-rules').textContent,
      ...Array.from(document.querySelectorAll('#panel-rules [data-label]'), el => el.dataset.label),
      ...Array.from(document.querySelectorAll('#panel-rules [aria-label]'), el => el.getAttribute('aria-label'))].join(' ')
  };
}"""
# The state that printing must leave alone (the screen state of the page)
SCREEN_STATE = """() => ({tab: (document.querySelector('[role="tab"][aria-selected="true"]') || {}).id,
  person: (document.querySelector('.person-buttons [aria-pressed="true"]') || {}).id,
  card: (document.querySelector('.card-buttons [aria-pressed="true"]') || {}).id,
  mode: (document.querySelector('.mode-buttons [aria-pressed="true"]') || {}).id,
  move: document.querySelector('#choose-move').value, caption: document.querySelector('#chain-map caption').textContent,
  account: (document.querySelector('#chain-map [aria-pressed="true"]') || {dataset: {}}).dataset.key || null,
  theme: document.documentElement.dataset.theme, lang: document.documentElement.lang,
  open: Array.from(document.querySelectorAll('details'), d => d.id + ':' + d.open).join(' ')})"""


def test_rules_tab(page, width, layouts, language):
    """Tab 4: the rules table (two columns at every width), rule 2 with its example, the symbols table (stacked below
    720px, each cell with its heading), the four notes with the related tools as new-tab links, what the model leaves out
    (kept open across a redraw), the paper section, the print button (window.print, no state change) and the guide of
    tab 1 that goes to the paper heading."""
    page.locator("#tab-rules").click()
    state = page.evaluate(RULES_STATE)
    check(state["heading"] == PANEL_HEADINGS[language][3] and state["intro"] == RULES_INTRO[language], ("rules heading", state["heading"]))
    rules = state["rules"]
    check(rules["caption"] and len(rules["heads"]) == 2, ("rules table: two columns", rules["heads"]))
    # The "#" heading is shown but not read; a screen reader reads a word instead
    check(state["noHead"] == {"hidden": ["#"], "spoken": [{"ja": "番号", "en": "Number"}[language]]}, ("rules table: # read as a word", state["noHead"]))
    check([row["no"] for row in rules["rows"]] == [str(n) for n in range(1, 11)], ("ten rules", [row["no"] for row in rules["rows"]]))
    check([row["rule"] for row in rules["rows"]] == list(RULES[language]), ("rules text", [row["rule"][:20] for row in rules["rows"]]))
    check(all(row["display"] == "table-row" for row in rules["rows"]), ("the rules table never stacks", width))
    check(RULE5_WORDS[language] in rules["rows"][4]["rule"], ("rule 5", rules["rows"][4]["rule"]))
    examples = [(row["no"], row["example"]) for row in rules["rows"] if row["example"]]
    check(examples == [("2", RULE2_EXAMPLE[language])] and rules["rows"][1]["exampleBlock"] == "block", ("the example under rule 2", examples))
    check(rules["width"] <= rules["frame"] + 0.5 and rules["font"] >= 14, ("rules table inside the panel, 14px", rules["width"], rules["font"]))
    symbols = state["symbols"]
    check(symbols["caption"] and symbols["headCount"] == 5, ("symbols table", symbols["caption"], symbols["headCount"]))
    check(symbols["width"] <= symbols["frame"] + 0.5 and symbols["font"] >= 14, ("symbols inside the panel, 14px", symbols["width"]))
    check(len(symbols["rows"]) == 9, ("nine symbols", len(symbols["rows"])))
    stacked = width < 720
    check(symbols["heads"] == ([] if stacked else list(SYMBOL_HEADS[language])), ("symbols headings", width, symbols["heads"]))
    for row, expected in zip(symbols["rows"], SYMBOL_ROWS[language]):
        check(row["display"] == ("block" if stacked else "table-row"), ("symbols stack below 720px", width, row["display"]))
        check([cell["text"] or None for cell in row["cells"]] == list(expected), ("symbol row", [cell["text"] for cell in row["cells"]]))
        for cell, head, value in zip(row["cells"], SYMBOL_HEADS[language], expected):
            check(cell["label"] == head, ("each cell carries its heading", cell["label"], head))
            if stacked:
                # A stacked cell shows its heading before its value; a blank cell of the spec is left out
                check(cell["shown"] == (value is not None), ("a blank cell is left out when stacked", head, cell))
                if value is not None:
                    check(cell["heading"] == head, ("the heading beside the value", cell["heading"], head))
            else:
                check(cell["heading"] is None, ("the heading inside the cell is hidden on wide screens", width, cell["heading"]))
    check(state["notes"] == list(RULE_NOTES[language]), ("the four notes", [note[:16] for note in state["notes"]]))
    check([(link["text"], link["href"]) for link in state["links"]] == list(NOTE_LINKS), ("links in the paper note", state["links"]))
    check(all(link["target"] == "_blank" and link["rel"] == "noopener noreferrer" for link in state["links"]), ("new tab", state["links"]))
    summary, items = NOT_IN_MODEL[language]
    check(state["notIn"]["summary"] == summary and not state["notIn"]["open"], ("not in the model: closed", state["notIn"]))
    check(state["notIn"]["items"] == list(items), ("not in the model: ten items", state["notIn"]["items"]))
    page.locator("#not-in-model > summary").click()
    check(page.evaluate(RULES_STATE)["notIn"]["shown"] == 10, "the ten items are shown when opened")
    page.locator("#person-parent").click()
    page.locator("#person-worker").click()
    check(page.locator("#not-in-model").evaluate("el => el.open"), "the box stays open across a redraw")
    paper = state["paper"]
    check(paper["heading"] and paper["tag"] == "H3" and paper["tabindex"] == "-1", ("paper heading", paper))
    check((paper["intro"], paper["button"]) == PAPER[language] and paper["describedby"] == "paper-intro", ("paper section", paper))
    assert_layout(page, width, "rules", layouts)
    page.locator("#not-in-model > summary").click()
    # The print button prints (window.print, replaced here so that no dialog opens) and changes nothing else
    page.evaluate("() => { window.__qaPrints = 0; window.print = () => { window.__qaPrints += 1; }; }")
    before = page.evaluate(SCREEN_STATE)
    press(page, "#print-button")
    check(page.evaluate("() => window.__qaPrints") == 1, "the print button calls window.print once")
    check(page.evaluate(SCREEN_STATE) == before, ("printing changes no state", page.evaluate(SCREEN_STATE), before))
    check(page.evaluate(ACTIVE)["id"] == "print-button", "the focus stays on the print button")
    # In English, nothing Japanese in tab 4 (shown or hidden text, the stacked headings)
    if language == "en":
        check(not JAPANESE.search(state["all"]), ("Japanese in tab 4", JAPANESE.findall(state["all"])[:10]))
    # The guide of tab 1 goes to the paper section: the rules tab, the focus on the paper heading in the viewport
    page.locator("#tab-chain").click()
    press(page, "#print-guide")
    check(page.locator("#tab-rules").get_attribute("aria-selected") == "true", "the guide opens the rules tab")
    heading = page.locator("#paper-heading")
    check(heading.evaluate("el => el === document.activeElement"), ("the focus is on the paper heading", page.evaluate(ACTIVE)))
    view = heading.evaluate(IN_VIEW)
    check(view["inside"], ("the paper heading is in the viewport", view))
    handle = heading.element_handle()
    page.keyboard.press("Tab")
    check(page.evaluate(ACTIVE)["id"] == "print-button", ("Tab goes on to the print button", page.evaluate(ACTIVE)))
    heading.focus()
    page.keyboard.press("Shift+Tab")
    back = page.evaluate_handle("() => document.activeElement")
    check(page.evaluate(ORDER, [back, handle]), ("Shift+Tab moves back from the paper heading", page.evaluate(ACTIVE)))
    layouts.append({"state": "rules-guide", "view": view})
    page.locator("#tab-chain").click()


# The whole text of the page, shown or hidden (closed details, the dialog, the printed sheets, SVG titles), with the attributes
# that are read (aria-label, title, data-label, option labels). The language button and <noscript> are left out (they carry
# both languages on purpose).
DOM_TEXT = """() => {
  const copy = document.body.cloneNode(true);
  copy.querySelectorAll('noscript').forEach(n => n.remove());
  const language = copy.querySelector('#language');
  if (language) language.textContent = '';
  const attributes = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('noscript')) continue;
    for (const name of ['aria-label', 'title', 'alt', 'placeholder', 'data-label', 'label', 'aria-description']) {
      const value = el.getAttribute(name);
      if (value) attributes.push(value);
    }
  }
  return [document.title, copy.textContent, ...attributes].join(' ');
}"""
NOT_ON_SCREEN = ("（仮）", "(provisional)", "この口座だけの系統", "Own family (")
# Every text node and read attribute of the page (shown or hidden), one unit each; the bibliography of the lessons, the language
# button and <noscript> are left out (the bibliography keeps titles as published; the other two carry both languages on purpose).
TEXT_UNITS = """() => {
  const skip = el => !el || !!el.closest('noscript, #language, .lesson-sources');
  const units = [document.title];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) { const text = node.data.trim(); if (text && !skip(node.parentElement)) units.push(text); }
  for (const el of document.body.querySelectorAll('*')) {
    if (skip(el)) continue;
    for (const name of ['aria-label', 'title', 'alt', 'placeholder', 'data-label', 'label', 'aria-description']) {
      const value = el.getAttribute(name);
      if (value) units.push(value);
    }
  }
  return units;
}"""
# Latin words allowed in a text without Japanese on the Japanese page: the list of the spec (abbreviations, the tool's name and
# the related tools' names), plus SNS (an account name of the data) and No. (a column of the blank sheet of the spec)
ALLOWED_LATIN = {"EN", "SMS", "SIM", "Day", "GitHub", "DOI", "NIST", "CCS", "CHI", "SOUPS", "NDSS", "INFOCOM", "ICISSP", "ETAA", "WWW",
                 "NCSC", "JPCERT/CC", "AAL2", "SSO", "ID", "OS", "Account", "Domino", "Mapper", "Intrusion", "Path", "Password", "Checker",
                 "PassCloud", "Reverse", "Brute-force", "Demo", "PatternLock", "Security", "Trainer", "PIN", "Threat", "Simulator",
                 "Scatter", "Seeds", "Overlay", "QR", "Shares", "SNS", "No"}
# Every link to another site opens in a new tab without opener or referrer
EXTERNAL_LINKS = """() => Array.from(document.querySelectorAll('a[href]'), a => ({href: a.getAttribute('href'), target: a.getAttribute('target'),
  rel: a.getAttribute('rel')})).filter(a => /^https?:/.test(a.href))"""


def latin_outside_list(units):
    """The Latin words of the texts without Japanese that are not on the allowed list."""
    found = []
    for unit in units:
        if JAPANESE.search(unit) or not re.search("[A-Za-z]", unit):
            continue
        for token in re.findall(r"[A-Za-z][A-Za-z0-9/'-]*", unit):
            if token not in ALLOWED_LATIN and not re.fullmatch(r"Day\d+", token):
                found.append((unit, token))
    return found


def assert_dom_words(page, language, name, results=None):
    text = page.evaluate(DOM_TEXT)
    for word in NOT_ON_SCREEN:
        check(word not in text, (name, "not in the DOM", word))
    check("口座" not in re.sub("証券口座|銀行口座", "", text), (name, "口座 only as 証券口座 or 銀行口座"))
    if language == "en":
        check(not JAPANESE.search(text), (name, "Japanese in the English page", JAPANESE.findall(text)[:10]))
    else:
        found = latin_outside_list(page.evaluate(TEXT_UNITS))
        check(not found, (name, "Latin-only text outside the allowed list on the Japanese page", found[:10]))
    links = page.evaluate(EXTERNAL_LINKS)
    check(links and all(a["target"] == "_blank" and a["rel"] == "noopener noreferrer" for a in links),
          (name, "external links open in a new tab", [a for a in links if a["target"] != "_blank" or a["rel"] != "noopener noreferrer"]))
    if results is not None:
        results.append({"state": name, "characters": len(text), "links": len(links)})


def test_dom_text(page, language, results):
    """The whole DOM (hidden parts, the help, the printed sheets and the diagrams' titles included) for the three people and
    the four tabs, and with the map after each suggestion of the six modes opened: no provisional names or the core's own-family
    label, 口座 only in the lessons' 証券口座/銀行口座, and nothing Japanese in English (the language button and noscript aside)."""
    page.wait_for_selector('#print-sheet[data-ready="true"]', state="attached")
    for pid in PEOPLE:
        page.locator("#person-" + pid).click()
        for tab in TABS:
            page.locator("#tab-" + tab).click()
            assert_dom_words(page, language, f"{pid}-{tab}")
        # Tab 3 with the map after the change opened, for the suggestion of each mode (a mode without one shows no map)
        page.locator("#tab-compare").click()
        press(page, '[data-key="mode:all"]')
        if not page.locator("#after-map").evaluate("el => el.open"):
            page.locator("#after-map > summary").click()
        for mode in MODES:
            press(page, f'[data-key="mode:{mode}"]')
            assert_dom_words(page, language, f"{pid}-{mode}-after-map")
        press(page, '[data-key="mode:all"]')
        page.locator("#after-map > summary").click()
    results.append({"state": "dom-text", "characters": len(page.evaluate(DOM_TEXT))})
    page.locator("#person-worker").click()
    page.locator("#tab-chain").click()


# ===== Stage 1c: the ten lessons of the help =====
# The names of the lessons (the spec's names in Japanese; the English titles of messages.js), each after its number
LESSON_TITLES = {
    "ja": ("アカウントの地図と「かつ・または」", "使い回しとリスト型攻撃", "復旧の線は入口にもなる（裏口）", "SMSとSIMスワップ", "窓口（ヘルプデスク）",
           "パスキーと証券口座", "閉め出し", "外すか、付け替えるか（紙の回復コード）", "模型の約束と研究の形式", "関連ツールと点検画面との関係"),
    "en": ("The account map and AND / OR", "Password reuse and credential stuffing", "A recovery line is also a way in (backdoors)",
           "SMS and SIM swaps", "Help desks", "Passkeys and brokerage accounts", "Lockout", "Remove or replace (paper recovery codes)",
           "The model and the research formalism", "Related tools and checkup screens"),
}
LESSONS_HEADING = {"ja": "座学", "en": "Lessons"}
# The help in order: the first steps, the controls, the terms, the lessons, the note on this learning aid
HELP_ORDER = ["helpFirst", "helpFirstText", "helpKeysHeading", "helpKeys", "helpTermsHeading", "help-terms", "lessonsHeading", "lessons",
              "helpAboutHeading", "helpAbout"]
LESSON_GRID = (3, 4, 5, 9)
# The paragraphs of each lesson in order, as message keys (the texts, the legend of lesson 3, the notes of lesson 6, the
# paragraph of lesson 8 with the two tools); the label of the sources follows when the lesson has sources
LESSON_PARAGRAPHS = {
    1: ("lesson1Text1", "lesson1Text2", "lesson1Text3", "lesson1Text4"), 2: ("lesson2Text1", "lesson2Text2", "lesson2Text3", "lesson2Text4"),
    3: ("lesson3Text1", "lesson3Text2", "lesson3Text3", "lesson3Text4", "fourCardsLegend"),
    4: ("lesson4Text1", "lesson4Text2", "lesson4Text3", "lesson4Text4"), 5: ("lesson5Text1", "lesson5Text2", "lesson5Text3"),
    6: ("lesson6Text1", "lesson6Text2", "lesson6Text3", "noteBrokerage", "noteBrokerageStudent"),
    7: ("lesson7Text1", "lesson7Text2", "lesson7Text3", "lesson7Text4"), 8: ("lesson8Text1", "lesson8Text2", "lesson8Text3"),
    9: ("lesson9Text1", "lesson9Text2", "lesson9Text3", "lesson9Text4"), 10: ("lesson10Text1", "lesson10Text2"),
}
LESSON_TABLES = {1: 2}
LESSON_SOURCES = {1: 2, 2: 5, 3: 4, 4: 4, 5: 2, 6: 5, 7: 3, 8: 2, 9: 2, 10: 0}
RELATED_TOOLS = (("Day083 Intrusion Path Mapper", "https://ipusiron.github.io/intrusion-path-mapper/"),
                 ("Day001 Password Checker", "https://ipusiron.github.io/password-checker/"),
                 ("Day019 PassCloud", "https://ipusiron.github.io/passcloud/"),
                 ("Day060 Reverse Brute-force Demo", "https://ipusiron.github.io/reverse-bruteforce-demo/"),
                 ("Day064 PatternLock Security Trainer", "https://ipusiron.github.io/patternlock-security-trainer/"),
                 ("Day088 PIN Threat Simulator", "https://ipusiron.github.io/pin-threat-simulator/"),
                 ("Day124 Scatter Seeds", "https://ipusiron.github.io/scatter-seeds/"),
                 ("Day125 Overlay QR Shares", "https://ipusiron.github.io/overlay-qr-shares/"))
LESSON_WORDS = {
    "ja": {"step": "段{step}", "fell": "段2で倒れる。開けた入口：登録メールで再設定", "stands": "倒れない", "falls": "倒れる", "none": "なし",
           "list": "・", "and": "と", "combos": "、", "noReplace": "付け替える先はない", "mail": {"mailA": "メールA", "mailB": "メールB"},
           "lost": {"pwA": "パスワードa", "pwB": "パスワードb"}},
    "en": {"step": "Step {step}", "fell": "Falls at step 2. Entrance used: Reset via registered email.", "stands": "Does not fall",
           "falls": "Falls", "none": "None", "list": ", ", "and": " and ", "combos": "; ", "noReplace": "Nothing to replace it with",
           "mail": {"mailA": "Email A", "mailB": "Email B"}, "lost": {"pwA": "password a", "pwB": "password b"}},
}
LESSON_STATE = """() => {
  const shownText = """ + SHOWN + """;
  const shown = el => !!el && el.getClientRects().length > 0;
  const cellText = cell => shownText(cell.querySelector('.cell-value') || cell);
  const body = document.querySelector('#help-dialog .help-body');
  return {
    order: Array.from(body.children, el => el.dataset.i18n || el.id),
    heading: document.querySelector('#lessons-heading').textContent,
    lessons: Array.from(document.querySelectorAll('#lessons > details'), d => ({
      id: d.id, open: d.open, title: d.querySelector(':scope > summary').textContent,
      paragraphs: Array.from(d.querySelectorAll('.lesson-body > p'), p => p.textContent),
      tables: Array.from(d.querySelectorAll('table'), t => ({grid: t.classList.contains('lesson-grid'),
        caption: t.querySelector('caption').textContent,
        heads: Array.from(t.querySelectorAll('thead th'), th => shownText(th) || th.textContent.trim()),
        rows: Array.from(t.querySelectorAll('tbody tr'), tr => Array.from(tr.children, cellText)),
        display: Array.from(t.querySelectorAll('tbody tr'), tr => getComputedStyle(tr).display),
        labels: Array.from(t.querySelectorAll('tbody tr > *'), c => c.dataset.label || null),
        width: t.getBoundingClientRect().width, frame: t.parentElement.getBoundingClientRect().width,
        font: Math.min(...Array.from(t.querySelectorAll('th, td, caption')).filter(c => shown(c) && c.textContent.trim())
          .map(c => parseFloat(getComputedStyle(c).fontSize)))})),
      links: Array.from(d.querySelectorAll('a'), a => ({text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'),
        rel: a.getAttribute('rel'), source: !!a.closest('.lesson-sources'), inline: !!a.closest('.lesson-body > p'),
        lang: a.closest('[lang]').getAttribute('lang')})),
      text: [d.textContent, ...Array.from(d.querySelectorAll('[data-label]'), el => el.dataset.label)].join(' ')}))
  };
}"""
# Where the shown lines of the grid tables of the lessons break: the two characters around each break
GRID_BREAKS = """() => {
  const out = [];
  for (const cell of document.querySelectorAll('#lessons table.lesson-grid th, #lessons table.lesson-grid td, #lessons table.lesson-grid caption')) {
    const chars = [];
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest('.visually-hidden') || !node.parentElement.getClientRects().length) continue;
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.height > 0) chars.push([node.data[i], rect.top]);
      }
    }
    for (let i = 1; i < chars.length; i++) {
      if (Math.abs(chars[i][1] - chars[i - 1][1]) > 2) out.push([cell.textContent, chars[i - 1][0], chars[i][0]]);
    }
  }
  return out;
}"""


def script_of(ch):
    """The kind of a character for the word-split check (the middle dot ・ separates words, so it is not katakana here)."""
    if re.match(r"[A-Za-z0-9]", ch):
        return "latin"
    if "゠" <= ch <= "ヿ" and ch != "・":
        return "katakana"
    if "㐀" <= ch <= "鿿":
        return "kanji"
    return "other"


def expected_lesson_rows(known, language):
    """The rows of the lessons' tables that are numbers or names, computed here from test/vectors.json and test/sample.json."""
    words, people = LESSON_WORDS[language], [known[pid] for pid in PEOPLE]
    names = PERSON_LABELS[language]
    rows = {}
    rows[3] = [[short] + [str(len(k["vectors"]["cards"][card]["backdoor"])) for k in people]
               for card, (short, _full) in zip(CARDS, FOUR_HEADS[language])]
    for number, card in ((4, "simswap"), (5, "desk")):
        rows[number] = [[names[i], str(len(k["vectors"]["cards"][card]["services"])), str(len(k["vectors"]["cards"][card]["backdoor"]))]
                        for i, k in enumerate(people)]
    vectors = json.loads((ROOT / "test" / "vectors.json").read_text(encoding="utf-8"))
    cycle = vectors["paper"]["cycle"]
    mail = lambda ids: words["list"].join(words["mail"][x] for x in ids) if ids else words["none"]
    rows[9] = [[words["lost"]["pwA"], mail(cycle["lostA"]["complementLocked"]), mail(cycle["lostA"]["def18Locked"])],
               [words["list"].join([words["lost"]["pwA"], words["lost"]["pwB"]]), mail(cycle["lostBoth"]["complementLocked"]),
                mail(cycle["lostBoth"]["def18Locked"])]]
    # Lesson 2: the number of accounts and their short names, per password family
    rows[2] = []
    for i, k in enumerate(people):
        for c in (c for c in k["person"]["credentials"] if c["type"] == "pw"):
            users = [s["id"] for s in k["person"]["services"] if any(c["id"] in m["requires"] for m in s["methods"])]
            rows[2].append([names[i], str(len(users)), words["list"].join(k["short"][language][s] for s in users)])
    # Lesson 6: the cards that make the brokerage fall alone, and the combinations
    rows[6] = []
    for i, k in enumerate(people):
        bases = k["vectors"]["cardBase"]["sec"]
        one = [CARD_NAMES[language][b[0]] for b in bases if len(b) == 1]
        combos = [words["and"].join(CARD_NAMES[language][c] for c in b) for b in bases if len(b) > 1]
        rows[6].append([names[i], words["list"].join(one) if one else words["none"], words["combos"].join(combos) if combos else words["none"]])
    # Lesson 7: the accounts with × or "one more loss"
    rows[7] = []
    for i, k in enumerate(people):
        table = k["vectors"]["lossTable"]
        for s in k["services"]:
            if any(table["cells"][loss][s]["mark"] == "locked" or table["cells"][loss][s]["plus"] for loss in table["columns"]):
                rows[7].append([names[i], k["full"][language][s]])
    return rows


def test_lessons(page, width, layouts, language, known):
    """The help in order (the first steps, the controls, the 22 terms, the ten lessons, the note); each lesson opens from its title
    with the keyboard (the focus stays on the title and Tab goes on to its links), shows its tables with the numbers computed here
    from the vectors and the data, names its sources as new-tab links, and stays open across closing the help and a language change."""
    page.wait_for_selector('#print-sheet[data-ready="true"]', state="attached")
    press(page, "#help")
    dialog = page.locator("#help-dialog")
    check(dialog.evaluate("el => el.open"), "the help is open")
    state = page.evaluate(LESSON_STATE)
    check(state["order"] == HELP_ORDER, ("the order of the help", state["order"]))
    check(state["heading"] == LESSONS_HEADING[language], ("lessons heading", state["heading"]))
    check([lesson["id"] for lesson in state["lessons"]] == ["lesson-" + str(n) for n in range(1, 11)], "ten lessons")
    titles = [str(n) + ". " + title for n, title in enumerate(LESSON_TITLES[language], 1)]
    check([lesson["title"] for lesson in state["lessons"]] == titles, ("lesson titles", [lesson["title"] for lesson in state["lessons"]]))
    check(not any(lesson["open"] for lesson in state["lessons"]), "the lessons start closed")
    # Each lesson opens with the keyboard on its title; the focus stays on the title, Tab reaches its first link, Shift+Tab comes back
    for number in range(1, 11):
        summary = f"#lesson-{number} > summary"
        page.locator(summary).focus()
        page.keyboard.press("Enter")
        check(page.locator(f"#lesson-{number}").evaluate("el => el.open"), ("the lesson opens", number))
        check(page.evaluate(HELP_ACTIVE) == "summary:lesson-" + str(number), ("the focus stays on the title", number))
        page.keyboard.press("Tab")
        active = page.evaluate(HELP_ACTIVE)
        check(active.startswith("link:") and page.evaluate("n => !!document.activeElement.closest('#lesson-' + n)", number),
              ("Tab goes on to the first link of the lesson", number, active))
        page.keyboard.press("Shift+Tab")
        check(page.evaluate(HELP_ACTIVE) == "summary:lesson-" + str(number), ("Shift+Tab returns to the title", number))
    state = page.evaluate(LESSON_STATE)
    expected = expected_lesson_rows(known, language)
    words = LESSON_WORDS[language]
    stacked = width < 720
    # The sentences themselves are checked against the spec by test G (node); here, which of them each lesson shows, in order
    dictionary = page.evaluate("lang => DominoMessages[lang]", language)
    tools = {"{day124}": NOTE_LINKS[0][0], "{day125}": NOTE_LINKS[1][0]}
    for number, lesson in enumerate(state["lessons"], 1):
        name = ("lesson", number)
        paragraphs = [dictionary[key] for key in LESSON_PARAGRAPHS[number]] + ([dictionary["lessonSources"]] if LESSON_SOURCES[number] else [])
        for mark, tool in tools.items():
            paragraphs = [text.replace(mark, tool) for text in paragraphs]
        check(lesson["open"] and lesson["paragraphs"] == paragraphs, (name, "open with its paragraphs", lesson["paragraphs"], paragraphs))
        check(len(lesson["tables"]) == LESSON_TABLES.get(number, 1), (name, "tables", len(lesson["tables"])))
        for table in lesson["tables"]:
            check(table["grid"] == (number in LESSON_GRID), (name, "grid", table["grid"]))
            check(table["caption"] and table["heads"] and table["rows"], (name, "caption, headings and rows"))
            check(table["width"] <= table["frame"] + 0.5 and table["font"] >= 14, (name, "inside the help, 14px", table["width"], table["font"]))
            if table["grid"] or not stacked:
                check(all(d == "table-row" for d in table["display"]), (name, "rows", width, set(table["display"])))
            else:
                # Stacked below 720px: every cell carries the heading of its column
                check(all(d == "block" for d in table["display"]), (name, "stacked", width, set(table["display"])))
                check(table["labels"] == table["heads"] * len(table["rows"]), (name, "each cell with its heading"))
        rows = lesson["tables"][0]["rows"]
        if number in (3, 4, 5, 9):
            check(rows == expected[number], (name, "numbers", rows, expected[number]))
        elif number == 2:
            check([[row[0], row[2], row[3]] for row in rows] == expected[2], (name, "families", rows))
        elif number == 6:
            check([[row[0], row[2], row[3]] for row in rows] == expected[6], (name, "brokerage", rows))
        elif number == 7:
            check([[row[0], row[1].lstrip("★")] for row in rows] == expected[7], (name, "lockout rows", rows))
        elif number == 1:
            check([row[0] for row in rows] == [words["step"].format(step=s) for s in range(3)] and rows[2][-1] == words["fell"], (name, rows))
            check([row[-1] for row in lesson["tables"][1]["rows"]] == [words["stands"], words["falls"]], (name, "AND / OR"))
        elif number == 8:
            check(len(rows) == 5 and rows[4][2] == words["noReplace"], (name, "five entrances", rows))
        # Links: the sources (new tab, HTTPS); an English title on the Japanese page is marked as English
        sources = [link for link in lesson["links"] if link["source"]]
        check(len(sources) == LESSON_SOURCES[number], (name, "sources", len(sources)))
        for link in lesson["links"]:
            check(link["href"].startswith("https://") and link["target"] == "_blank" and link["rel"] == "noopener noreferrer", (name, link))
        for link in sources:
            check(link["lang"] == ("en" if language == "en" or not JAPANESE.search(link["text"]) else "ja"), (name, "lang", link))
        if number == 8:
            inline = [link["text"] for link in lesson["links"] if link["inline"]]
            check(inline == [NOTE_LINKS[0][0], NOTE_LINKS[1][0]], (name, "inline links", inline))
        if number == 10:
            tools_shown = [(link["text"], link["href"]) for link in lesson["links"]]
            check(tools_shown == list(RELATED_TOOLS), (name, "related tools", tools_shown))
        if language == "en":
            check(not JAPANESE.search(lesson["text"]), (name, "Japanese in the English lesson", JAPANESE.findall(lesson["text"])[:10]))
    # No English word or number of a grid table is split across lines (the Japanese text of the lessons breaks as the browser does)
    breaks = [b for b in page.evaluate(GRID_BREAKS) if script_of(b[1]) == script_of(b[2]) == "latin"]
    check(not breaks, ("a word split in a grid table of the lessons", breaks[:5]))
    assert_layout(page, width, "lessons-open", layouts)
    # With the lessons open, the focus still cycles inside the help: from the close button back to the last link, and on to the start
    page.locator("#close-help").focus()
    page.keyboard.press("Shift+Tab")
    check(page.evaluate(HELP_ACTIVE) == "link:" + RELATED_TOOLS[-1][1], ("Shift+Tab from the first item goes to the last link",
                                                                      page.evaluate(HELP_ACTIVE)))
    # Only the help text scrolls: the dialog itself keeps its title and close button in view (hidden texts stay inside the help text)
    box = dialog.evaluate("el => [el.scrollHeight, el.clientHeight, el.scrollTop]")
    check(box[0] <= box[1] + 1 and box[2] == 0, ("the help dialog itself does not scroll", box))
    page.keyboard.press("Tab")
    check(page.evaluate(HELP_ACTIVE) == "close-help", "Tab from the last link goes to the close button")
    # The close button closes the help and gives the focus back to the help button; the lessons stay open when it opens again
    page.keyboard.press("Enter")
    check(not dialog.evaluate("el => el.open"), "the close button closes the help")
    check(page.evaluate("() => document.activeElement.id") == "help", "the focus returns to the help button")
    other = "en" if language == "ja" else "ja"
    page.locator("#language").click()
    # The lessons follow the language at once, also while the help is closed (their hidden text included)
    other_titles = [str(n) + ". " + t for n, t in enumerate(LESSON_TITLES[other], 1)]
    closed = page.evaluate("() => ({titles: Array.from(document.querySelectorAll('#lessons > details > summary'), s => s.textContent),"
                           " text: document.querySelector('#lessons').textContent})")
    check(closed["titles"] == other_titles, ("the lesson titles follow the language while the help is closed", closed["titles"][:2]))
    check(bool(JAPANESE.search(closed["text"])) == (other == "ja"), ("the lesson bodies follow the language while the help is closed",
                                                                      JAPANESE.findall(closed["text"])[:5]))
    press(page, "#help")
    reopened = page.evaluate(LESSON_STATE)
    check(all(lesson["open"] for lesson in reopened["lessons"]), "the lessons stay open across closing the help and a language change")
    check([lesson["title"] for lesson in reopened["lessons"]] == [str(n) + ". " + t for n, t in enumerate(LESSON_TITLES[other], 1)],
          "the titles follow the language")
    check(reopened["lessons"][2]["tables"][0]["rows"] == expected_lesson_rows(known, other)[3], "the tables follow the language")
    if other == "en":
        check(not any(JAPANESE.search(lesson["text"]) for lesson in reopened["lessons"]), "no Japanese left after the language change")
    page.keyboard.press("Escape")
    page.locator("#language").click()
    for number in range(1, 11):
        page.evaluate("n => { document.querySelector('#lesson-' + n).open = false; }", number)
    check(page.evaluate("() => document.documentElement.lang") == language, "the language is back")
    layouts.append({"state": "lessons", "lessons": [{"id": lesson["id"], "tables": [{"grid": t["grid"], "rows": len(t["rows"]),
        "width": t["width"], "frame": t["frame"], "font": t["font"]} for t in lesson["tables"]], "links": len(lesson["links"])}
        for lesson in state["lessons"]]})


# Opens every link to another site in a new tab (requests to other sites are answered here with an empty page, so that nothing
# leaves this machine): the new tab has the link's address and no opener, and the page keeps its tab, person and card.
PAGE_STATE = """() => ({tab: (document.querySelector('[role="tab"][aria-selected="true"]') || {}).id,
  person: (document.querySelector('.person-buttons [aria-pressed="true"]') || {}).id,
  card: (document.querySelector('.card-buttons [aria-pressed="true"]') || {}).id, help: document.querySelector('#help-dialog').open})"""


def links_case(browser, browser_name, url, width, language, theme, output):
    name = f"{browser_name}-{width}-{language}-{theme}-links"
    context = new_context(browser, browser_name, width, language, theme)
    answered = []

    def answer(route):
        answered.append(route.request.url)
        route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>link</title>")

    context.route(lambda target: target.startswith(("http://", "https://")) and not target.startswith("http://127.0.0.1"), answer)
    page = context.new_page()
    errors, violations = observe(page, url)
    opened = []
    try:
        page.goto(set_language_query(url, language), wait_until="load")
        wait_ready(page)
        page.wait_for_selector('#print-sheet[data-ready="true"]', state="attached")
        page.locator("#person-parent").click()
        page.locator("#card-simswap").click()
        page.locator("#tab-rules").click()

        def follow(link, state):
            href = link.get_attribute("href")
            with context.expect_page() as info:
                link.click()
            tab = info.value
            tab.wait_for_load_state("load")
            check(tab.url == href, (name, "the new tab opens the link", tab.url, href))
            check(tab.evaluate("() => window.opener === null"), (name, "no opener", href))
            tab.close()
            check(page.evaluate(PAGE_STATE) == state, (name, "the page keeps its state", href, page.evaluate(PAGE_STATE), state))
            opened.append(href)

        state = page.evaluate(PAGE_STATE)
        check(state == {"tab": "tab-rules", "person": "person-parent", "card": "card-simswap", "help": False}, (name, state))
        for link in [page.locator("footer a"), *page.locator("#rules-notes a").all()]:
            follow(link, state)
        press(page, "#help")
        for number in range(1, 11):
            page.evaluate("n => { document.querySelector('#lesson-' + n).open = true; }", number)
        state = page.evaluate(PAGE_STATE)
        check(state["help"], (name, "the help is open"))
        for link in page.locator('#lessons a[href^="http"]').all():
            follow(link, state)
        total = page.evaluate("() => document.querySelectorAll('a[href^=\"http\"]').length")
        check(len(opened) == total and len(opened) >= 40, (name, "every link was followed", len(opened), total))
        check(len(answered) >= len(opened), (name, "requests answered here", len(answered)))
        page.keyboard.press("Escape")
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "links": len(opened), "answered": len(answered)}
    except Exception as error:
        page.screenshot(path=str(output / (name + "-failed.png")), full_page=False)
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations, "links": opened}
    finally:
        context.close()


# The printed sheets: their state in print media (what is shown, the pages and what names them, the tables with their
# captions and width, the text color, the font sizes of the text shown and the heights of the blank rows)
PRINT_STATE = """() => {
  const sheet = document.querySelector('#print-sheet');
  const text = el => el.textContent.replace(/\\s+/g, ' ').trim();
  const colors = new Set([getComputedStyle(sheet).color]);
  for (const el of sheet.querySelectorAll('*')) colors.add(getComputedStyle(el).color);
  const px = el => parseFloat(getComputedStyle(el).fontSize);
  const sizes = sel => Array.from(sheet.querySelectorAll(sel)).filter(el => el.textContent.trim() && !el.closest('.visually-hidden')).map(px);
  return {ready: sheet.dataset.ready || null,
    shown: Array.from(document.body.children).filter(el => el.getClientRects().length > 0).map(el => el.id || el.tagName),
    sheetWidth: sheet.clientWidth, sheetScroll: sheet.scrollWidth,
    page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, colors: Array.from(colors),
    fonts: {sheet: px(sheet), body: sizes('.print-story, .print-disclaimer, .print-keep p, .print-how li'),
      tables: sizes('table th, table td, table caption, .print-abbr li')},
    blankRows: Array.from(sheet.querySelectorAll('.print-form-table tbody tr'), tr => tr.getBoundingClientRect().height),
    pages: Array.from(sheet.querySelectorAll(':scope > .print-page'), p => ({person: p.dataset.person || null,
      title: text(p.querySelector('h2')), titleId: p.querySelector('h2').id, labelledby: p.getAttribute('aria-labelledby'),
      height: p.getBoundingClientRect().height, after: getComputedStyle(p).breakAfter, text: text(p),
      tables: Array.from(p.querySelectorAll('table'), t => ({cls: t.className, width: t.getBoundingClientRect().width,
        scroll: t.scrollWidth, client: t.clientWidth, heads: Array.from(t.querySelectorAll('thead th'), text),
        caption: (c => (c ? {text: text(c), hidden: c.classList.contains('visually-hidden'), position: getComputedStyle(c).position,
          width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height} : null))(t.querySelector(':scope > caption')),
        labelledby: t.getAttribute('aria-labelledby'),
        rows: Array.from(t.querySelectorAll('tbody tr'), tr => Array.from(tr.children, text))}))}))};
}"""
# Runs before the page's scripts: zero-delay timers wait until the test releases them (the page builds the printed sheets
# in one right after startup); __qaHeld() counts the timers still waiting.
HOLD_ZERO_TIMERS = """(() => {
  const original = window.setTimeout.bind(window), held = [];
  let released = false;
  window.setTimeout = (callback, delay, ...args) => {
    if (!released && !delay) { held.push(() => callback(...args)); return 0; }
    return original(callback, delay, ...args);
  };
  Object.defineProperty(window, '__qaHeld', {value: () => held.length});
  Object.defineProperty(window, '__qaReleaseTimers', {value: () => { released = true; for (const run of held.splice(0)) original(run, 0); }});
})();"""
PRINT_TITLE = {"ja": "{person}の地図（架空の人物）", "en": "Map: {person} (fictional)"}
PRINT_DISCLAIMER = {
    "ja": "この地図は、架空の人物を単純化した規則で数えた結果です。実際のサービスは、不審なログインの検知や通知も持っています。"
          "書類の確認を破る手口と、パスワードを忘れることは数えていません。",
    "en": "This map counts a fictional person's accounts with simplified rules. Real services also detect suspicious log-ins and send "
          "notifications. Forged documents and forgotten passwords are not counted.",
}
FORM_TITLE = {"ja": "わたしの地図（記号で書く用紙）", "en": "My map (fill in with symbols)"}
KEEP_SAFE = {"ja": "保管注意（弱点の地図）", "en": "Keep safe (map of weak points)"}
FORM_HEADS = {"ja": ["No.", "アカウント（略称）", "★", "ロ／復", "条件（記号）", "メモ"],
              "en": ["No.", "Account (short)", "★", "Log/Rec", "Requirements (symbols)", "Notes"]}
# The headings of the printed map table in document order: the two first columns, the group headings over the four attack
# cards and the three losses, then the columns under them
PRINT_HEADS = {"ja": ["アカウント", "入口", "攻撃カード", "失ったとき", "漏えい", "SIM", "メール乗っ取り", "窓口", "スマホ", "番号"],
               "en": ["Account", "Entrances", "Attack cards", "When lost", "Breach", "SIM", "Email takeover", "Desk", "Phone", "Number"]}
PRINT_LEGEND_LINES = {"ja": ("SIM＝SIMスワップ", "窓口＝窓口のなりすまし", "裏＝裏口", "－＝倒れない", "○＝入れる",
                             "○（＋番号で×）＝番号も失うと入れない"),
                      "en": ("SIM = SIM swap", "Desk = Help-desk impersonation", "bd = backdoor", "– = does not fall",
                             "○ = can get in", "○ (× if the number goes too) = losing the number too locks you out")}
BACKDOOR_MARK = {"ja": "{cell}裏", "en": "{cell} bd"}
# The short tags of the printed entrances (the spec's names of the symbols)
COLOR_WORDS = {"ja": {"red": "赤", "blue": "青", "gray": "灰", "yellow": "黄", "green": "緑", "purple": "紫"},
               "en": {"red": "Red ", "blue": "Blue ", "gray": "Gray ", "yellow": "Yellow ", "green": "Green ", "purple": "Purple "}}
TAG_WORDS = {"ja": {"device": "スマホ", "phone": "SMS", "info": "個人情報", "idcheck": "書類"},
             "en": {"device": "Phone", "phone": "SMS", "info": "Personal details", "idcheck": "Documents"}}
ENTRANCE = {"ja": ("ロ：", "復：", "＋", "／"), "en": ("Log: ", "Rec: ", " + ", " / ")}


def expected_print_rows(k, language):
    """The printed table of one person from the test data and the known vectors: ★ and full name, the entrances in
    symbols, the four cards at their last step (the backdoor mark added), the three lockout cells written out."""
    credentials = {c["id"]: c for c in k["person"]["credentials"]}
    login, recovery, plus, between = ENTRANCE[language]

    def tag(node):
        c = credentials.get(node)
        if c is None:
            return k["short"][language][node]
        return COLOR_WORDS[language][c["family"]] + c["symbol"] if c["type"] == "pw" else TAG_WORDS[language][c["type"]]
    rows = []
    for service in k["person"]["services"]:
        sid = service["id"]
        entrances = between.join((login if m["role"] == "login" else recovery) + plus.join(tag(r) for r in m["requires"])
                                 for m in service["methods"])
        attack = []
        for card in CARDS:
            result = k["vectors"]["cards"][card]
            rank = result["rank"].get(sid)
            cell = CELL_NONE[language] if rank is None else "●" + str(rank)
            attack.append(BACKDOOR_MARK[language].format(cell=cell) if rank is not None and sid in result["backdoor"] else cell)
        table = k["vectors"]["lossTable"]
        losses = [lock_text(k, table["cells"][column][sid], language) for column in table["columns"]]
        rows.append((("★" if sid in k["important"] else "") + k["full"][language][sid], entrances, attack, losses))
    return rows


def caption_off_paper(caption):
    """A hidden caption in print media: taken out of the flow and clipped to about one pixel (.visually-hidden), so that a
    later rule undoing it, which would print the table's title a second time, is caught."""
    return caption["position"] == "absolute" and caption["width"] <= 1.5 and caption["height"] <= 3


def assert_print_sheet(page, known, language, name, results):
    """In print media (viewport 703px = 186mm at 96dpi): only the printed sheets are shown, four pages (the three people,
    then the blank sheet) each named by its heading, the tables 9, 7 and 7 rows following the known vectors, each table named
    by its caption, every table inside the page width, black text even when the screen is dark, and the sizes of the spec
    (body text, tables and blank rows) not below their lower bounds."""
    page.emulate_media(media="print")
    state = page.evaluate(PRINT_STATE)
    check(state["ready"] == "true" and state["shown"] == ["print-sheet"], (name, "only the printed sheets", state["shown"]))
    check(state["colors"] == ["rgb(0, 0, 0)"], (name, "black text in print", state["colors"]))
    check(state["page"] <= state["client"] and state["sheetScroll"] <= state["sheetWidth"], (name, "no horizontal overflow", state["page"]))
    # Sizes in print media (the spec's guide values with lower bounds: body text 10.5pt, never changed; tables 9.5pt, at least
    # 9pt; the 18 rows of the blank table 7mm, at least 6.5mm), in CSS pixels, apart from the page count of page.pdf
    pt, mm = 96 / 72, 96 / 25.4
    fonts = state["fonts"]
    check(abs(fonts["sheet"] - 10.5 * pt) < 0.05 and fonts["body"] and all(abs(size - 10.5 * pt) < 0.05 for size in fonts["body"]),
          (name, "printed body text 10.5pt", fonts["sheet"], sorted(set(fonts["body"]))))
    check(fonts["tables"] and min(fonts["tables"]) >= 9 * pt - 0.05, (name, "printed tables 9pt or larger", sorted(set(fonts["tables"]))))
    check(len(state["blankRows"]) == 18 and min(state["blankRows"]) >= 6.5 * mm - 0.05,
          (name, "18 blank rows, each 6.5mm or taller", len(state["blankRows"]), min(state["blankRows"], default=None)))
    pages = state["pages"]
    check([p["person"] for p in pages] == [*PEOPLE, None], (name, "four pages: three people and the blank sheet", [p["person"] for p in pages]))
    check([p["after"] for p in pages] == ["page", "page", "page", "auto"], (name, "a page break after each person", [p["after"] for p in pages]))
    for p in pages:
        # A page is named by its heading; every table by its own caption (not by the heading: aria-labelledby would win
        # over the caption)
        check(p["labelledby"] and p["labelledby"] == p["titleId"], (name, p["person"], "the page is named by its heading", p["labelledby"]))
        for table in p["tables"]:
            check(table["scroll"] <= table["client"] and table["width"] <= state["sheetWidth"] + 0.5,
                  (name, p["person"], table["cls"], "the table fits the page width", table["width"], table["scroll"], table["client"]))
            check(table["caption"] and table["caption"]["text"] and table["labelledby"] is None,
                  (name, p["person"], table["cls"], "a caption names the table", table["caption"], table["labelledby"]))
    for pid, p in zip(PEOPLE, pages):
        k = known[pid]
        title = PRINT_TITLE[language].format(person=PERSON_LABELS[language][PEOPLE.index(pid)])
        check(p["title"] == title, (name, pid, "title", p["title"]))
        check(PRINT_DISCLAIMER[language] in p["text"], (name, pid, "the model's caution on each person's page"))
        table = next(t for t in p["tables"] if t["cls"] == "print-map")
        # The heading shown above names the table on paper; its caption says the same, hidden so that the page keeps its form
        # (and the title is not printed twice): out of the flow in print media, a box of about one pixel
        check(table["caption"]["text"] == title and table["caption"]["hidden"] and caption_off_paper(table["caption"]),
              (name, pid, "the map table's caption", table["caption"]))
        check(table["heads"] == PRINT_HEADS[language] + [mail_head(k, language)], (name, pid, "headings", table["heads"]))
        expected = expected_print_rows(k, language)
        check(len(table["rows"]) == len(expected) == len(k["services"]), (name, pid, "one row per account", len(table["rows"])))
        for row, (account, entrances, attack, losses) in zip(table["rows"], expected):
            # The whole row: the name, the entrances, the four cards and the three losses (nine cells), each written out
            check(row == [account, entrances, *attack, *losses], (name, pid, "row", row, [account, entrances, *attack, *losses]))
    check([len(next(t for t in p["tables"] if t["cls"] == "print-map")["rows"]) for p in pages[:3]] == [9, 7, 7], (name, "9, 7 and 7 rows"))
    # Every person's page carries the legend, the short names and the marks, so that one page can be handed out alone
    for pid, p in zip(PEOPLE, pages):
        legend = next(t for t in p["tables"] if t["cls"] == "print-legend")
        check([row for row in legend["rows"]] == [[r[0], r[1]] for r in SYMBOL_ROWS[language]], (name, pid, "the legend: symbol and meaning"))
        check(all(line in p["text"] for line in PRINT_LEGEND_LINES[language]), (name, pid, "the short names and the marks under the legend"))
    # A Japanese word in the map tables stays whole, and a lockout cell never starts a line with "×）"
    split = page.evaluate(TEXT_SPLITS, [".print-map th", ".print-map td"])
    check(not any(split.values()), (name, "a word is split in a printed map table", split))
    starts = [lines for lines in page.evaluate(BOX_LINES, ".print-map td.print-loss") if any(line.startswith("×）") for line in lines)]
    check(not starts, (name, "a printed lockout cell starts a line with ×）", starts))
    # A lone × (locked out) is printed bold and larger, as on screen: the parent's bank and the student's subscription
    locked = page.evaluate("""() => Array.from(document.querySelectorAll('.print-map td.print-loss'))
      .filter(td => td.textContent === '×').map(td => (m => (m ? getComputedStyle(m).fontWeight : null))(td.querySelector('.mark-locked')))""")
    check(len(locked) == 2 and all(weight is not None and int(weight) >= 700 for weight in locked), (name, "a lone × printed bold", locked))
    form = pages[3]
    check(form["title"] == FORM_TITLE[language] and KEEP_SAFE[language] in form["text"], (name, "the blank sheet", form["title"]))
    blank = next(t for t in form["tables"] if t["cls"] == "print-form-table")
    check(blank["caption"]["text"] == FORM_TITLE[language] and blank["caption"]["hidden"] and caption_off_paper(blank["caption"]),
          (name, "the blank table's caption", blank["caption"]))
    check(blank["heads"] == FORM_HEADS[language] and len(blank["rows"]) == 18, (name, "the blank table: 18 rows", blank["heads"]))
    check(all(row[1:] == ["", "", "", "", ""] for row in blank["rows"]), (name, "the blank rows are empty"))
    check(any(t["cls"] == "print-legend" for t in form["tables"]), (name, "the legend on the blank sheet"))
    results.append({"state": name, "pages": [{key: p[key] for key in ("person", "title", "height")} for p in pages],
                    "tables": [[{key: t[key] for key in ("cls", "width", "scroll", "client")} for t in p["tables"]] for p in pages],
                    "sizes": {"sheet": fonts["sheet"], "body": sorted(set(fonts["body"])), "tables": sorted(set(fonts["tables"])),
                              "blankRows": sorted(set(round(h, 3) for h in state["blankRows"]))}})
    page.emulate_media(media="null")


def pdf_pages(page, path, known, language):
    """page.pdf (A4, 12mm margins) and the text of each page read back with pypdf: exactly four pages, none empty, the
    people's maps on the first three and the blank sheet on the fourth."""
    import unicodedata
    from pypdf import PdfReader
    page.pdf(path=str(path), format="A4", margin={"top": "12mm", "right": "12mm", "bottom": "12mm", "left": "12mm"})
    texts = [unicodedata.normalize("NFKC", item.extract_text() or "") for item in PdfReader(str(path)).pages]
    flat = [re.sub(r"\s+", "", text) for text in texts]
    check(len(texts) == 4, ("page.pdf has exactly four pages", len(texts), [text[:60] for text in texts]))
    check(all(text.strip() for text in texts), ("every page has text", [len(text) for text in texts]))
    for index, pid in enumerate(PEOPLE):
        title = re.sub(r"\s+", "", unicodedata.normalize("NFKC", PRINT_TITLE[language].format(person=PERSON_LABELS[language][index])))
        check(title in flat[index], ("the map of each person on its own page", pid, flat[index][:80]))
    check(re.sub(r"\s+", "", unicodedata.normalize("NFKC", FORM_TITLE[language])) in flat[3], ("the blank sheet on page 4", flat[3][:80]))
    return [len(text) for text in texts]


# Puts a wider font on the printed sheets (a constructed style sheet; the page's own files are not changed), or takes it off
WIDE_FONT = """on => {
  if (on) { const sheet = new CSSStyleSheet();
    sheet.replaceSync('#print-sheet, #print-sheet * { font-family: Verdana, sans-serif !important; }');
    window.__qaWideFont = sheet; document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }
  else document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.__qaWideFont);
}"""


def print_case(browser, browser_name, url, language, theme, output, known, early=False):
    """The printed sheets at 703px (186mm at 96dpi): built after startup (data-ready) or, with the page's timers held, by
    beforeprint; the print media state; page.pdf in Chromium (four pages, also with a wider font); the same screen state
    before and after; the sheets follow a language change."""
    name = f"{browser_name}-{language}-{theme}-print" + ("-early" if early else "")
    context = browser.new_context(viewport={"width": 703, "height": 900}, locale="ja-JP" if language == "ja" else "en-US",
                                  color_scheme=theme, reduced_motion="reduce")
    page = context.new_page()
    errors, violations = observe(page, url)
    count_persona_vectors(page)
    results = []
    try:
        if early:
            # The page's zero-delay timers are held, so the timer that builds the sheets after startup has not run when the
            # browser's print asks for them (beforeprint); released afterwards, it must not build them again.
            page.add_init_script(HOLD_ZERO_TIMERS)
            page.goto(set_language_query(url, language), wait_until="load")
            # The deferred scripts have run by the load event (read directly, without polling in the page)
            check(page.evaluate("() => document.documentElement.dataset.appReady") == "true", "ready at the load event")
            pending = page.evaluate("() => ({ready: document.querySelector('#print-sheet').dataset.ready || null,"
                                    " pages: document.querySelectorAll('#print-sheet .print-page').length, held: window.__qaHeld()})")
            check(pending == {"ready": None, "pages": 0, "held": 1}, ("the sheets wait for the startup timer", pending))
            page.evaluate("() => window.dispatchEvent(new Event('beforeprint'))")
            check(page.evaluate("() => document.querySelector('#print-sheet').dataset.ready") == "true", "beforeprint builds the sheets")
            assert_vectors_built(page, "beforeprint builds the three people once each", everyone=True)
            page.evaluate("() => { window.__qaFirstPage = document.querySelector('#print-sheet .print-page'); }")
            page.evaluate("() => window.__qaReleaseTimers()")
            # The released startup timer was queued first, so it has run when a timer queued now runs
            page.evaluate("() => new Promise(resolve => setTimeout(resolve, 10))")
            check(page.evaluate("() => window.__qaHeld()") == 0, "the startup timer ran")
            check(page.evaluate("() => document.querySelector('#print-sheet .print-page') === window.__qaFirstPage"),
                  "the timer does not build the sheets again")
        else:
            page.goto(set_language_query(url, language), wait_until="load")
            wait_ready(page)
            page.wait_for_selector('#print-sheet[data-ready="true"]', state="attached")
            assert_vectors_built(page, "the sheets are built after the three people", everyone=True)
        check(page.evaluate("() => document.documentElement.dataset.theme") == theme, "theme")
        # A state on screen that printing must keep: tab 3, the parent, the SIM swap mode
        page.locator("#tab-compare").click()
        page.locator("#person-parent").click()
        press(page, '[data-key="mode:simswap"]')
        page.locator("#ranking > summary").click()
        before = page.evaluate(SCREEN_STATE)
        check(not page.locator("#print-sheet").is_visible(), "the sheets are hidden on screen")
        assert_print_sheet(page, known, language, name, results)
        if browser_name == "chromium":
            # page.pdf (A4, 12mm margins) with the print media, then back to no media emulation
            page.emulate_media(media="print")
            results.append({"state": name + "-pdf", "characters": pdf_pages(page, output / (name + ".pdf"), known, language)})
            if theme == "light" and not early:
                # A wider system font (Verdana where it is installed) still keeps the four pages: the blank sheet with its
                # 18 rows of 7mm and its legend stays on page 4
                page.evaluate(WIDE_FONT, True)
                results.append({"state": name + "-pdf-wide", "characters": pdf_pages(page, output / (name + "-wide.pdf"), known, language),
                                "font": page.evaluate("() => getComputedStyle(document.querySelector('#print-sheet td')).fontFamily")})
                page.evaluate(WIDE_FONT, False)
            page.emulate_media(media="null")
        check(page.evaluate(SCREEN_STATE) == before, ("printing changes no state", page.evaluate(SCREEN_STATE), before))
        check(not page.locator("#print-sheet").is_visible() and page.locator("main").is_visible(), "the screen is back")
        # Another language rebuilds the sheets in that language (still ready); back again
        other = "en" if language == "ja" else "ja"
        page.locator("#language").click()
        title = page.evaluate("() => document.querySelector('#print-sheet h2').textContent")
        check(title == PRINT_TITLE[other].format(person=PERSON_LABELS[other][0]), ("the sheets follow the language", title))
        check(page.evaluate("() => document.querySelector('#print-sheet').dataset.ready") == "true", "still ready")
        page.locator("#language").click()
        assert_print_sheet(page, known, language, name + "-again", results)
        assert_vectors_built(page, "printing builds nothing again", everyone=True)
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "results": results}
    except Exception as error:
        try:
            page.screenshot(path=str(output / (name + "-failed.png")), full_page=False, timeout=10000)
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations, "results": results}
    finally:
        context.close()


CLOCK_START = datetime.datetime(2026, 1, 1, 9, 0, 0)
# The checks that matter after the page state changed: step (caption), card, person, selected account, playback, step line.
STATE_KEYS = """() => ({caption: document.querySelector('#chain-map caption').textContent,
  card: (document.querySelector('.card-buttons [aria-pressed="true"]') || {}).id,
  person: (document.querySelector('.person-buttons [aria-pressed="true"]') || {}).id,
  account: (document.querySelector('#chain-map [aria-pressed="true"]') || {dataset: {}}).dataset.key,
  playing: document.querySelector('#step-play').getAttribute('aria-pressed'),
  line: document.querySelector('#step-line').textContent})"""
WATCH_STATUS = """() => {
  window.__qaStatus = []; window.__qaCaptions = [];
  new MutationObserver(() => window.__qaStatus.push(document.querySelector('#step-status').textContent))
    .observe(document.querySelector('#step-status'), {childList: true, characterData: true, subtree: true});
  new MutationObserver(() => window.__qaCaptions.push(document.querySelector('#chain-map caption').textContent))
    .observe(document.querySelector('#chain-map'), {childList: true});
}"""


def take_clock(page):
    """Playwright's clock takes the page's timers: time runs while the page starts, then stops an hour later, so that the
    playback moves only when the test moves the clock (no race with real time)."""
    page.clock.install(time=CLOCK_START)


def stop_clock(page):
    page.clock.pause_at(CLOCK_START + datetime.timedelta(hours=1))


def expected_runs(k, card, step):
    """The transitions that a step starts in the diagram: the border (stroke and its width) of every box or card that falls
    at that step, and the stroke of every line into the entrance that opened it."""
    result = k["vectors"]["cards"][card]
    runs = set()
    for node, rank in result["rank"].items():
        if rank != step:
            continue
        runs |= {("node " + node, "stroke"), ("node " + node, "stroke-width")}
        if node in result["via"]:
            row = result["via"][node]
            runs |= {("line " + requirement + "->" + row, "stroke") for requirement in k["methods"][row]["requires"]}
    return sorted(runs)


def record_transitions(page, action, expected, name):
    """Records transitionrun from just before the action, waits (in real time: the page clock does not drive CSS
    transitions) until as many transitions as expected have started, and checks that exactly these ran."""
    page.evaluate(TRANSITION_RECORDER)
    action()
    try:
        page.wait_for_function("(n) => window.__qaRuns.length >= n", arg=len(expected), timeout=5000)
    except Exception:
        pass  # the comparison below shows what was recorded
    runs = sorted({tuple(run) for run in page.evaluate("() => window.__qaRuns")})
    check(runs == expected, (name, "the transitions that ran", runs, expected))
    return runs


def playback_case(browser, browser_name, url, width, language, theme, output, known):
    """Playback without reduced motion, on the page clock: one step every 900 ms, the status written once at the last step;
    Stop, the person shown and another card stop it, and nothing moves afterwards even 5 s later. On wide screens the
    borders and lines of what falls change with a transition, both with Next step and during playback."""
    name = f"{browser_name}-{width}-{language}-{theme}-playback"
    context = browser.new_context(viewport={"width": width, "height": 900}, locale="ja-JP" if language == "ja" else "en-US",
                                  color_scheme=theme, reduced_motion="no-preference")
    page = context.new_page()
    errors, violations = observe(page, url)
    try:
        take_clock(page)
        page.goto(set_language_query(url, language), wait_until="load")
        wait_ready(page)
        check(not page.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches"), "motion allowed")
        stop_clock(page)
        k = known["worker"]
        # An hour of page time has passed: nothing played on its own
        assert_chain(page, k, "worker", "leak", 0, language, "no autoplay")
        transitions = {}
        if width >= 720:
            # Next step repaints the same diagram, and what falls at step 1 changes with a transition.
            page.evaluate("() => { window.__qaSvg = document.querySelector('#chain-figure svg'); }")
            transitions["next"] = record_transitions(page, lambda: press(page, "#step-next"), expected_runs(k, "leak", 1), "Next step")
            check(page.evaluate("() => document.querySelector('#chain-figure svg') === window.__qaSvg"), "the diagram is kept")
            assert_svg_state(page, k, "worker", "leak", 1, language, "step 1 with motion")
            press(page, "#step-first")
            assert_chain(page, k, "worker", "leak", 0, language, "back to step 0")
        page.evaluate(WATCH_STATUS)
        press(page, "#step-play")
        state = assert_chain(page, k, "worker", "leak", 0, language, "playing from step 0")
        check(state["steps"]["play"]["pressed"] == "true" and state["steps"]["play"]["text"].startswith("■"), ("playing", state["steps"]))
        check(page.evaluate(ACTIVE)["id"] == "step-play", "the focus stays on the play button")
        page.clock.run_for(PLAY_INTERVAL - 1)
        assert_chain(page, k, "worker", "leak", 0, language, "still step 0 just before 900 ms")
        if width >= 720:
            transitions["play"] = record_transitions(page, lambda: page.clock.run_for(1), expected_runs(k, "leak", 1), "playback")
        else:
            page.clock.run_for(1)
        state = assert_chain(page, k, "worker", "leak", 1, language, "step 1 at 900 ms")
        check(state["steps"]["play"]["pressed"] == "true", ("still playing", state["steps"]["play"]))
        if width >= 720:
            assert_svg_state(page, k, "worker", "leak", 1, language, "step 1 while playing")
        page.clock.run_for(PLAY_INTERVAL)
        state = assert_chain(page, k, "worker", "leak", 2, language, "step 2 at 1800 ms")
        check(state["steps"]["play"]["pressed"] == "false", ("playback ends at the last step", state["steps"]["play"]))
        if width >= 720:
            assert_svg_state(page, k, "worker", "leak", 2, language, "played")
        page.clock.run_for(5000)
        assert_chain(page, k, "worker", "leak", 2, language, "nothing moves after the last step")
        writes = page.evaluate("() => window.__qaStatus")
        check(writes == [expected_status(k, "leak", 2, language)], ("one status write at the last step", writes))
        captions = page.evaluate("() => window.__qaCaptions")
        steps = [int(re.search(r"(\d+)\)?$", re.sub(r"[）)]$", "", caption)).group(1)) for caption in captions]
        check(steps == [0, 1, 2], ("one step at a time", captions))
        # Stop at step 1: the step stays, even 5 s later, and nothing is announced.
        press(page, "#step-play")
        page.clock.run_for(PLAY_INTERVAL)
        assert_chain(page, k, "worker", "leak", 1, language, "playing again: step 1")
        press(page, "#step-play")
        stopped = assert_chain(page, k, "worker", "leak", 1, language, "stopped at step 1")
        check(stopped["steps"]["play"]["pressed"] == "false", ("stopped", stopped["steps"]["play"]))
        check(stopped["steps"]["next"]["disabled"] is None, ("Next step is still available", stopped["steps"]["next"]))
        page.clock.run_for(5000)
        assert_chain(page, k, "worker", "leak", 1, language, "the step stays after Stop")
        if width >= 720:
            assert_svg_state(page, k, "worker", "leak", 1, language, "stopped at step 1")
        check(page.evaluate("() => window.__qaStatus") == writes, "no status write when stopped")
        # Pressing the person already shown stops playback too, at the step it reached.
        press(page, "#step-play")
        page.clock.run_for(PLAY_INTERVAL)
        page.locator("#person-worker").click()
        held = assert_chain(page, k, "worker", "leak", 1, language, "the same person stops playback")
        check(held["steps"]["play"]["pressed"] == "false", ("not playing", held["steps"]["play"]))
        page.clock.run_for(5000)
        assert_chain(page, k, "worker", "leak", 1, language, "the step stays after the person button")
        # Another card stops it as well (and shows that card at its last step, the live region emptied without a word).
        press(page, "#step-play")
        page.locator("#card-mail").click()
        moved = assert_chain(page, k, "worker", "mail", last_step(k, "mail"), language, "a card change stops playback")
        check(moved["steps"]["play"]["pressed"] == "false", ("not playing", moved["steps"]["play"]))
        page.clock.run_for(5000)
        assert_chain(page, k, "worker", "mail", last_step(k, "mail"), language, "nothing moves after the card change")
        check([write for write in page.evaluate("() => window.__qaStatus") if write] == writes, "only the one status write")
        page.clock.resume()
        page.screenshot(path=str(output / (name + ".png")), full_page=False)
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "writes": writes, "captions": captions, "transitions": transitions}
    except Exception as error:
        try:
            page.clock.resume()
            page.screenshot(path=str(output / (name + "-failed.png")), full_page=False, timeout=10000)
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "errors": errors, "violations": violations}
    finally:
        context.close()


FOCUSED = """() => { const a = document.activeElement;
  return {key: a && a.dataset ? a.dataset.key || null : null, id: a ? a.id : null, shown: !!a && a.getClientRects().length > 0,
    visible: !!a && a.matches(':focus-visible')}; }"""


def resize_case(browser, browser_name, url, output, known):
    """Crossing 720px on one page. The back button under the detail (narrow only) and the diagram's frame (wide only, it
    scrolls at 760px) stop being shown: the focus goes to the name of the selected account in the map table. The name
    itself stays shown both ways and keeps the focus. Width changes leave the state alone, playback included. In tab 3,
    the frame of the map after a change behaves the same, and the focus goes to the name in that map."""
    name = f"{browser_name}-resize"
    context = browser.new_context(viewport={"width": 390, "height": 900}, locale="ja-JP", reduced_motion="no-preference")
    page = context.new_page()
    errors, violations = observe(page, url)
    log = []

    def resize(width, key, what):
        page.set_viewport_size({"width": width, "height": 900})
        page.wait_for_function("(narrow) => matchMedia('(max-width: 719px)').matches === narrow", arg=width < 720)
        try:
            page.wait_for_function("(key) => document.activeElement && document.activeElement.dataset.key === key", arg=key, timeout=3000)
        except Exception:
            pass  # the check below shows where the focus is
        focused = page.evaluate(FOCUSED)
        log.append({"width": width, "what": what, "focus": focused})
        check(focused["key"] == key and focused["shown"] and focused["visible"], (what, width, "focus", focused))

    try:
        take_clock(page)
        page.goto(set_language_query(url, "ja"), wait_until="load")
        wait_ready(page)
        stop_clock(page)
        k = known["worker"]
        press(page, "#step-next")
        press(page, '[data-key="chain-acct:bank"]')
        check(page.evaluate(ACTIVE)["id"] == "detail-heading", ("narrow: the name moves the focus to the detail", page.evaluate(ACTIVE)))
        page.keyboard.press("Tab")
        check(page.evaluate(ACTIVE)["id"] == "back-to-map", ("Tab reaches the back button", page.evaluate(ACTIVE)))
        before = page.evaluate(STATE_KEYS)
        check(before["account"] == "chain-acct:bank" and before["playing"] == "false", ("state before", before))
        resize(1280, "chain-acct:bank", "the back button is hidden on wide screens")
        check(page.evaluate(STATE_KEYS) == before, ("the width changes nothing", page.evaluate(STATE_KEYS), before))
        resize(390, "chain-acct:bank", "the name stays shown on narrow screens")
        check(page.evaluate(STATE_KEYS) == before, ("the width changes nothing", page.evaluate(STATE_KEYS), before))
        # The diagram's frame scrolls at 760px, so it takes the focus with Tab; narrowing hides it.
        page.set_viewport_size({"width": 760, "height": 900})
        page.wait_for_function("() => !matchMedia('(max-width: 719px)').matches")
        page.locator("#step-play").focus()
        tab_until(page, lambda active: active["id"] == "chain-figure", 6)
        resize(390, "chain-acct:bank", "the diagram's frame is hidden on narrow screens")
        check(page.evaluate(STATE_KEYS) == before, ("the width changes nothing", page.evaluate(STATE_KEYS), before))
        # Playback goes on across the widths, one step per 900 ms of the page clock.
        press(page, "#step-first")
        press(page, "#step-play")
        page.set_viewport_size({"width": 1280, "height": 900})
        page.wait_for_function("() => !matchMedia('(max-width: 719px)').matches")
        state = assert_chain(page, k, "worker", "leak", 0, "ja", "playing, widened")
        check(state["steps"]["play"]["pressed"] == "true", ("still playing after widening", state["steps"]["play"]))
        page.clock.run_for(PLAY_INTERVAL)
        page.set_viewport_size({"width": 390, "height": 900})
        page.wait_for_function("() => matchMedia('(max-width: 719px)').matches")
        state = assert_chain(page, k, "worker", "leak", 1, "ja", "playing, narrowed")
        check(state["steps"]["play"]["pressed"] == "true", ("still playing after narrowing", state["steps"]["play"]))
        page.clock.run_for(PLAY_INTERVAL)
        state = assert_chain(page, k, "worker", "leak", 2, "ja", "played across the widths")
        check(state["steps"]["play"]["pressed"] == "false", ("playback ends at the last step", state["steps"]["play"]))
        page.clock.resume()
        # Tab 3: the frame of the map after a change scrolls at 760px (the worker's diagram is wider than its box), so it
        # takes the focus with Tab; narrowing hides it, and the focus goes to the selected account's name in that map.
        page.set_viewport_size({"width": 760, "height": 900})
        page.wait_for_function("() => !matchMedia('(max-width: 719px)').matches")
        page.locator("#tab-compare").click()
        page.locator("#after-map > summary").click()
        page.locator("#phase-after").focus()
        tab_until(page, lambda active: active["id"] == "after-figure", 8)
        resize(390, "after-acct:bank", "the frame of the map after a change is hidden on narrow screens")
        check(page.locator("#after-map").evaluate("el => el.open"), "the map box stays open across the widths")
        page.screenshot(path=str(output / (name + ".png")), full_page=False)
        assert_clean(errors, violations)
        return {"case": name, "status": "passed", "focus": log}
    except Exception as error:
        try:
            page.clock.resume()
            page.screenshot(path=str(output / (name + "-failed.png")), full_page=False, timeout=10000)
        except Exception:
            pass
        return {"case": name, "status": "failed", "error": str(error), "focus": log, "errors": errors, "violations": violations}
    finally:
        context.close()


def initial_chain(page, language, known):
    """Opened without saved state: step 0 with the table, the summary, the detail and the start-here line filled in.
    The step line sits right under the step buttons, above the hint of the last step (hidden at step 0) and the summary."""
    state = assert_chain(page, known["worker"], "worker", "leak", 0, language, "initial")
    check(state["startHere"] and state["summary"] and state["detail"] and state["story"] and state["cardLine"], ("initial", state))
    check(state["status"] == "", "no announcement at startup")
    check(page.evaluate("""() => { const line = document.querySelector('#step-line'), hint = line.nextElementSibling;
      return line.previousElementSibling.classList.contains('step-controls') && hint.id === 'step-hint' && hint.hidden
        && hint.nextElementSibling.id === 'step-summary'; }"""),
          "the step line between the step buttons and the summary (the hint between them hidden at step 0)")


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


def matrix_case(browser, browser_name, url, width, language, theme, output, counts, stage, known):
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
        if stage >= "1b":
            initial_chain(page, language, known)
        page.screenshot(path=str(output / (name + "-initial.png")), full_page=False)
        test_person_band(page, width, layouts, language, counts)
        test_tabs(page, width, layouts, language)
        if stage >= "1b" and width <= 390:
            assert_tab_names(page, width, language, layouts)
        test_help(page, width, layouts, output / (name + "-help.png"), language)
        if stage >= "1b":
            test_chain_tab(page, width, layouts, language, known)
            test_lockout_tab(page, width, layouts, language, known)
            if width < 720:
                test_narrow_tables(page, width, language, known, layouts)
                if theme == "light":  # the theme does not change where a line breaks
                    test_word_lines(page, width, language, layouts)
            test_highlights(page, width, language, known)
            page.screenshot(path=str(output / (name + "-stage1b.png")), full_page=False)
            assert_vectors_built(page, "after the stage 1b checks", everyone=True)
        if stage >= "1c":
            test_compare_tab(page, width, layouts, language, known)
            test_compare_highlights(page, width, language, known, layouts)
            test_compare_updates(page, width, language, known, layouts)
            test_owner_decisions(page, width, language, known, layouts)
            page.screenshot(path=str(output / (name + "-stage1c.png")), full_page=False)
            test_rules_tab(page, width, layouts, language)
            page.locator("#tab-rules").click()
            page.screenshot(path=str(output / (name + "-rules.png")), full_page=False)
            test_dom_text(page, language, layouts)
            test_lessons(page, width, layouts, language, known)
            if theme == "light":  # the theme does not change where a line breaks
                test_table_words(page, width, language, layouts)
            # The map after a change is computed with the person after it: personaVectors is still built once per person
            assert_vectors_built(page, "after the stage 1c checks", everyone=True)
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
        # Wait for the request of app.js to reach the route that holds it (polled every 50 ms, at most 5 s)
        for _ in range(100):
            if held:
                break
            page.wait_for_timeout(50)
        check(len(held) == 1, "app.js is held")
        pending = page.evaluate(SNAPSHOT)
        check(pending["ready"] == "false", "unfinished application must not signal readiness")
        check(pending["toolsDisabled"] and pending["controlsDisabled"] and pending["allDisabled"],
              "both groups stay disabled until ready")
        # The four-cards box has nothing to show before the first drawing: it is not shown and cannot take the focus
        check(not pending["fourCards"]["shown"] and not pending["fourCards"]["open"], ("four cards before ready", pending["fourCards"]))
        check(not page.evaluate(SUMMARY_FOCUS), "the four-cards summary cannot take the focus before ready")
        if language == "ja" and width <= 390:
            # Before app.js runs, the static tab names carry a <wbr> between their words (Firefox has no auto-phrase)
            for tab, label in zip(page.evaluate(TAB_LINES), TAB_LABELS["ja"]):
                check(tuple(tab["lines"]) in TAB_SPLITS[label], ("a tab name before ready", tab))
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
        # When ready, the four-cards box is shown and opens on its table
        check(ready["fourCards"]["shown"] and not ready["fourCards"]["open"], ("four cards when ready", ready["fourCards"]))
        page.locator("#four-cards > summary").click()
        check(page.locator("#four-cards").evaluate("el => el.open") and page.locator("#four-cards-table tbody tr").count() == 9,
              "the four-cards box opens when ready")
        page.locator("#four-cards > summary").click()
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


def http_case(browser, browser_name, base_url, width, output, counts, stage, known):
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
        if stage >= "1b":
            initial_chain(page, "en", known)
        test_person_band(page, width, layouts, "en", counts)
        test_tabs(page, width, layouts, "en")
        test_help(page, width, layouts, output / (name + "-help.png"), "en")
        if stage >= "1b":
            test_chain_tab(page, width, layouts, "en", known)
            test_lockout_tab(page, width, layouts, "en", known)
            test_highlights(page, width, "en", known)
        if stage >= "1c":
            test_compare_tab(page, width, layouts, "en", known)
            test_compare_highlights(page, width, "en", known, layouts)
            test_rules_tab(page, width, layouts, "en")
            test_dom_text(page, "en", layouts)
            test_lessons(page, width, layouts, "en", known)
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
    known = load_known()
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
                        record(matrix_case(browser, browser_name, args.url, width, language, theme, output, counts,
                                           args.stage, known))
            for result in precedence_cases(browser, browser_name, args.url):
                record(result)
            if args.stage >= "1b":
                for width, language, theme in ((1280, "ja", "light"), (320, "en", "dark")):
                    record(playback_case(browser, browser_name, args.url, width, language, theme, output, known))
                record(resize_case(browser, browser_name, args.url, output, known))
            if args.stage >= "1c":
                # The printed sheets in both languages and themes (page.pdf in Chromium), and once with the timers held
                for language, theme, early in (("ja", "light", False), ("ja", "dark", False), ("en", "light", False),
                                               ("en", "dark", False), ("ja", "dark", True)):
                    record(print_case(browser, browser_name, args.url, language, theme, output, known, early))
                # Every link to another site, clicked: a new tab with the link's address, no opener, the page's state kept
                for width, language, theme in ((1280, "ja", "light"), (320, "en", "dark")):
                    record(links_case(browser, browser_name, args.url, width, language, theme, output))
            with local_http() as http_url:
                for width in HTTP_WIDTHS:
                    record(http_case(browser, browser_name, http_url, width, output, counts, args.stage, known))
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
