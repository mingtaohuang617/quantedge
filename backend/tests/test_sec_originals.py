"""Inline-XBRL scale, units, periods, dimensions and fail-closed regressions."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_sec_originals import compare, parse_original  # noqa: E402


def document(value='1,234', attrs='scale="6" format="ixt:num-dot-decimal"', segment='', period=None):
    period = period or '<x:startDate>2024-01-01</x:startDate><x:endDate>2024-03-31</x:endDate>'
    return f'''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:x="http://www.xbrl.org/2003/instance"
    xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:us-gaap="http://fasb.org/us-gaap/2024"
    xmlns:iso="http://www.xbrl.org/2003/iso4217" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12">
    <x:context id="c"><x:entity><x:identifier scheme="http://www.sec.gov/CIK">0001045810</x:identifier>{segment}</x:entity>
    <x:period>{period}</x:period></x:context>
    <x:unit id="u"><x:measure>iso:USD</x:measure></x:unit>
    <ix:nonFraction name="us-gaap:NetIncomeLoss" contextRef="c" unitRef="u" id="f" {attrs}>{value}</ix:nonFraction>
    </html>'''


def parse(html):
    return parse_original(html, '0001045810')


def test_scale_sign_and_original_locator():
    rows, issues = parse(document(attrs='scale="6" sign="-" format="ixt:num-dot-decimal"'))
    assert rows[0]['value'] == '-1234000000'
    assert rows[0]['context_id'] == 'c'
    assert rows[0]['fact_id'] == 'f'
    assert not issues


def test_instant_and_dimensions_never_become_quarterly_totals():
    rows, _ = parse(document(period='<x:instant>2024-03-31</x:instant>'))
    assert rows[0]['start'] is None
    rows, issues = parse(document(segment='<x:segment>division</x:segment>'))
    assert not rows
    assert issues['excluded_context_or_unit'] == 1


@pytest.mark.parametrize('value,attrs', [('1.234,56', 'format="ixt:num-comma-decimal"'),
    ('1,23', 'format="ixt:num-dot-decimal"'), ('123', 'continuedAt="next"'), ('1', 'scale="999"')])
def test_unsupported_number_fails_closed(value, attrs):
    rows, issues = parse(document(value, attrs))
    assert not rows
    assert issues['unsupported_numeric_fact'] == 1


def test_eps_unit_division_and_zero_transform():
    html = document('0.61', '').replace('us-gaap:NetIncomeLoss', 'us-gaap:EarningsPerShareDiluted')
    html = html.replace('<x:measure>iso:USD</x:measure>', '<x:divide><x:unitNumerator><x:measure>iso:USD</x:measure></x:unitNumerator><x:unitDenominator><x:measure>x:shares</x:measure></x:unitDenominator></x:divide>')
    rows, _ = parse(html)
    assert rows[0]['unit'] == 'USD/shares'
    assert rows[0]['value'] == '0.61'
    rows, _ = parse(document('—', 'format="ixt:fixed-zero"'))
    assert rows[0]['value'] == '0'


def test_wrong_entity_and_namespace_are_not_accepted():
    assert not parse(document().replace('0001045810', '0000000001'))[0]
    assert not parse(document().replace('http://fasb.org/us-gaap/2024', 'https://example.com/custom'))[0]


def test_exact_comparison_and_conflict_block():
    rows, _ = parse(document())
    candidate = {**rows[0], 'value': 1234000000}
    assert compare([candidate], rows)[0]['original_check'] == 'matched'
    assert compare([{**candidate, 'start': '2023-01-01'}], rows)[0]['original_check'] == 'missing_original_context'
    assert compare([{**candidate, 'value': 1}], rows)[0]['original_check'] == 'value_mismatch'
    assert compare([candidate], rows + [{**rows[0], 'value': '2'}])[0]['original_check'] == 'ambiguous_original_context'


def test_duplicate_context_and_dtd_are_rejected():
    html = document()
    context = html[html.index('<x:context'):html.index('</x:context>') + len('</x:context>')]
    with pytest.raises(ValueError):
        parse(html.replace('</html>', context + '</html>'))
    with pytest.raises(ValueError):
        parse('<!DOCTYPE html [<!ENTITY bad "123">]>' + html)


def test_old_taxonomy_transform_and_local_html_entity():
    html = document('1,234&nbsp;', 'scale="3" format="ixt:numdotdecimal"')
    html = html.replace('http://fasb.org/us-gaap/2024', 'http://fasb.org/us-gaap/2020-01-31')
    assert parse(html)[0][0]['value'] == '1234000'


def test_traditional_instance_uses_explicit_value_without_scale_inference():
    html = document('-51522000', '')
    html = html.replace('<html ', '<x:xbrl ').replace('</html>', '</x:xbrl>')
    html = html.replace('<ix:nonFraction name="us-gaap:NetIncomeLoss"', '<us-gaap:NetIncomeLoss')
    html = html.replace('</ix:nonFraction>', '</us-gaap:NetIncomeLoss>')
    assert parse(html)[0][0]['value'] == '-51522000'
