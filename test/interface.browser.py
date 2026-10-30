"""Browser gates for Account Domino Mapper (Playwright for Python; not part of CI).

Run with a Python environment that already contains Playwright:
    python test/interface.browser.py --stage 1b
    python test/interface.browser.py --stage 1b --output <folder>
    python test/interface.browser.py --stage 1b --url http://127.0.0.1:8000/
A stage also runs the checks of the stages before it (1b runs the 1a checks too).
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
STAGES = ("1a", "1b")
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
    # The diagram is drawn at its natural size; below 808px its figure may scroll inside itself (never the page).
    unexpected = [box for box in measured["wraps"] if not (box["el"] == "figure#chain-figure" and width < 808)]
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
# Characters that may not start a line (Japanese line-breaking rules); no <wbr> may stand right before one of them
NO_LINE_START = "、。，．・：；？！ー）」』】〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ"
CARD_NOTE_START = {"ja": {"leak": "漏えいのカードは", "simswap": "SMSの線は", "desk": "電話の窓口は"},
                   "en": {"leak": "The breach card", "simswap": "An SMS line opens", "desk": "A phone help desk"}}
LOCK_MARKS = {"ja": {"ok": "○", "locked": "×", "gone": "消", "plus": "○（＋"},
              "en": {"ok": "○", "locked": "×", "gone": "gone", "plus": "○ (× if "}}
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
SVG_METRICS = """() => {
  const figure = document.querySelector('#chain-figure'), svg = figure.querySelector('svg');
  const css = getComputedStyle(figure), px = v => parseFloat(v) || 0;
  const frame = px(css.paddingLeft) + px(css.paddingRight) + px(css.borderLeftWidth) + px(css.borderRightWidth)
    + px(css.marginLeft) + px(css.marginRight);
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
SVG_STATE = """() => {
  const svg = document.querySelector('#chain-figure svg');
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
# that splits a word within one text box. A line may break at a space, at a <wbr>, after 、。・：＋）」,.;:)-/ or before an
# opening bracket; any other break splits a word (a word and its particle, ★ and the name, a comma that starts a line), and
# so does a break between two Latin letters or digits, two katakana or two kanji, even at a <wbr>.
# For the lockout table, also the width it takes when no word may be split (its .break-words class taken off for a moment).
NARROW_TABLE = """(sel) => {
  const frame = document.querySelector(sel), table = frame.querySelector('table');
  const BOX = 'caption, th, td, button, li, .backdoor-label, .this-step-label';
  const AFTER = '、。・：＋）」,.;:)-/', BEFORE = '（(';
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


def assert_svg_state(page, k, pid, card, step, language, name):
    """The diagram follows the step: fallen boxes and cards (●step), open entrances and the thick lines into them, title, desc."""
    state = page.evaluate(SVG_STATE)
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


def assert_svg(page, width, pid, name, results):
    metrics = page.evaluate(SVG_METRICS)
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
            for column, cell in zip(table["columns"], row["cells"]):
                known_cell = table["cells"][column][row["id"]]
                kind = "plus" if known_cell["mark"] == "ok" and known_cell["plus"] else known_cell["mark"]
                mark = LOCK_MARKS[language][kind]
                check(cell["text"].startswith(mark) if kind == "plus" else cell["text"] == mark, (pid, row["id"], column, cell))
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
        limit = TABLE_LIMITS.get(("lock", width, language))
        if pid == "parent" and limit is not None:
            check(table["body"] <= limit, (name, "height of the lockout table without the caption", table["body"], limit))
        results.append({"state": name, "table": table})
    page.locator("#tab-chain").click()
    page.locator("#person-worker").click()


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
    """W1, P1, P2, S1-S3 by keyboard only: the state they set, the focus target in the viewport, then Tab and Shift+Tab."""
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
    itself stays shown both ways and keeps the focus. Width changes leave the state alone, playback included."""
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
    The step line sits right under the step buttons, above the summary."""
    state = assert_chain(page, known["worker"], "worker", "leak", 0, language, "initial")
    check(state["startHere"] and state["summary"] and state["detail"] and state["story"] and state["cardLine"], ("initial", state))
    check(state["status"] == "", "no announcement at startup")
    check(page.evaluate("""() => { const line = document.querySelector('#step-line');
      return line.previousElementSibling.classList.contains('step-controls') && line.nextElementSibling.id === 'step-summary'; }"""),
          "the step line between the step buttons and the summary")


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
            test_highlights(page, width, language, known)
            page.screenshot(path=str(output / (name + "-stage1b.png")), full_page=False)
            assert_vectors_built(page, "after the stage 1b checks", everyone=True)
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
