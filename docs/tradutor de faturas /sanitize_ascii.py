#!/usr/bin/env python3
"""
sanitize_ascii.py

Sanitiza um arquivo ASCII posicional de fatura antes de enviá-lo a uma LLM.

Objetivo:
- Remover dados pessoais diretamente identificáveis
- Preservar o máximo possível do layout e do contexto útil
- Operar localmente, sem dependência de IA

Estratégia:
- Redação determinística por regex para CPF, CNPJ, CEP, e-mail, telefone, PIX e cartões
- Redação por rótulo para nomes e endereços
- Redação por linha para trechos claramente identificáveis como cadastro pessoal

Saída:
- Texto sanitizado
- Opcionalmente, um relatório JSON com as redacções aplicadas
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Sequence


@dataclass(frozen=True)
class Redaction:
    category: str
    original: str
    replacement: str
    line_number: int


EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
CPF_RE = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
CNPJ_RE = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
CEP_RE = re.compile(r"\b\d{5}-?\d{3}\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}(?!\d)")
PIX_RE = re.compile(
    r"\b(?:chave\s+pix|pix)\b.*?(?=$|\n)",
    re.IGNORECASE,
)
CARD_MASKED_RE = re.compile(
    r"\b\d{4}(?:[.\s-]\*{2,}|\s+\*{2,}|[.\s-]\d{2,})[.\s-]\*{2,}[.\s-]\d{4}\b",
    re.IGNORECASE,
)
NAME_LABEL_RE = re.compile(
    r"(?P<label>\b(?:nome|titular|cliente|consumidor|pagador|sacado|remetente|destinat[aá]rio|respons[aá]vel)\b[^:\n]{0,30}[:\-]?\s*)(?P<value>[^\n]+)",
    re.IGNORECASE,
)

ADDRESS_LABEL_RE = re.compile(
    r"(?P<label>\b(?:endere[cç]o|logradouro|rua|r\.|avenida|av\.|bairro|cep|n[úu]mero|num\.?|nº|n°|bloco|apto|apartamento|sala)\b[^:\n]{0,20}[:\-]?\s*)(?P<value>[^\n]+)",
    re.IGNORECASE,
)

ADDRESS_LINE_HINTS = (
    "RUA ",
    "AV ",
    "AVENIDA ",
    "ALAMEDA ",
    "TRAVESSA ",
    "RODOVIA ",
    "ESTRADA ",
    "PRAÇA ",
    "PRACA ",
    "BAIRRO ",
    "CEP ",
    "APTO ",
    "APARTAMENTO ",
    "BLOCO ",
    "SALA ",
)

SENSITIVE_LINE_HINTS = (
    "CPF",
    "CNPJ",
    "CEP",
    "ENDERE",
    "NOME",
    "TITULAR",
    "CLIENTE",
    "REMETENTE",
    "DESTINAT",
    "SACADO",
    "PAGADOR",
    "RESPONS",
    "PIX",
)


def _mask_same_length(value: str, mask_char: str = "#") -> str:
    return mask_char * len(value)


def _redact_pattern(
    text: str,
    pattern: re.Pattern[str],
    category: str,
    redactions: list[Redaction],
    line_number: int,
    replacement_factory=None,
) -> str:
    def replacer(match: re.Match[str]) -> str:
        original = match.group(0)
        replacement = replacement_factory(original) if replacement_factory else _mask_same_length(original)
        redactions.append(Redaction(category=category, original=original, replacement=replacement, line_number=line_number))
        return replacement

    return pattern.sub(replacer, text)


def _looks_like_address_line(line: str) -> bool:
    upper = line.upper()
    if any(hint in upper for hint in ADDRESS_LINE_HINTS):
        return True
    return bool(re.search(r"\b\d{1,5}\b", upper)) and bool(
        re.search(r"\b(?:RUA|AVENIDA|ALAMEDA|TRAVESSA|RODOVIA|ESTRADA|PRA[CÇ]A|BAIRRO|APTO|APARTAMENTO|BLOCO|SALA)\b", upper)
    )


def _redact_labelled_value(line: str, pattern: re.Pattern[str], category: str, redactions: list[Redaction], line_number: int) -> str:
    def replace(match: re.Match[str]) -> str:
        label = match.group("label")
        value = match.group("value")
        replacement = _mask_same_length(value)
        redactions.append(Redaction(category=category, original=value, replacement=replacement, line_number=line_number))
        return f"{label}{replacement}"

    return pattern.sub(replace, line)


def _redact_card_lines(line: str, redactions: list[Redaction], line_number: int) -> str:
    if not any(token in line.upper() for token in ("CARTAO", "CARTÃO", "CARD", "FINAL")):
        return line

    if re.search(r"\d{4}(?:[.\s-]\*{2,}|[.\s-]\d{2,})[.\s-]\*{2,}[.\s-]\d{4}", line):
        redactions.append(
            Redaction(
                category="card",
                original=line,
                replacement=_mask_same_length(line),
                line_number=line_number,
            )
        )
        return _mask_same_length(line)

    return line


def sanitize_line(line: str, line_number: int, redactions: list[Redaction]) -> str:
    original_line = line

    line = _redact_pattern(line, EMAIL_RE, "email", redactions, line_number)
    line = _redact_pattern(line, CPF_RE, "cpf", redactions, line_number)
    line = _redact_pattern(line, CNPJ_RE, "cnpj", redactions, line_number)
    line = _redact_pattern(line, CEP_RE, "cep", redactions, line_number)
    line = _redact_pattern(line, PHONE_RE, "phone", redactions, line_number)
    line = _redact_pattern(line, PIX_RE, "pix", redactions, line_number)
    line = _redact_pattern(line, CARD_MASKED_RE, "card", redactions, line_number)

    line = _redact_labelled_value(line, NAME_LABEL_RE, "name", redactions, line_number)
    line = _redact_labelled_value(line, ADDRESS_LABEL_RE, "address", redactions, line_number)

    if _looks_like_address_line(line):
        redactions.append(
            Redaction(
                category="address",
                original=original_line,
                replacement=_mask_same_length(original_line),
                line_number=line_number,
            )
        )
        return _mask_same_length(original_line)

    line = _redact_card_lines(line, redactions, line_number)

    if any(token in original_line.upper() for token in SENSITIVE_LINE_HINTS):
        if original_line != line:
            return line
        if re.search(r"\b[A-ZÁÉÍÓÚÃÕÇ][A-ZÁÉÍÓÚÃÕÇ]+\b", original_line) and len(original_line.split()) <= 8:
            redactions.append(
                Redaction(
                    category="name",
                    original=original_line,
                    replacement=_mask_same_length(original_line),
                    line_number=line_number,
                )
            )
            return _mask_same_length(original_line)

    return line


def sanitize_ascii_text(text: str) -> tuple[str, list[Redaction]]:
    redactions: list[Redaction] = []
    sanitized_lines = [
        sanitize_line(line, idx + 1, redactions)
        for idx, line in enumerate(text.splitlines())
    ]
    return "\n".join(sanitized_lines), redactions


def sanitize_ascii_file(input_path: Path, output_path: Path | None = None, report_path: Path | None = None) -> Path:
    text = input_path.read_text(encoding="utf-8")
    sanitized, redactions = sanitize_ascii_text(text)

    if output_path is None:
        output_path = input_path.with_suffix(".sanitized.txt")

    output_path.write_text(sanitized, encoding="utf-8")

    if report_path is not None:
        report_path.write_text(
            json.dumps(
                {
                    "input": str(input_path),
                    "output": str(output_path),
                    "count": len(redactions),
                    "redactions": [asdict(r) for r in redactions],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    return output_path


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sanitiza ASCII posicional de faturas antes de enviar à LLM.")
    parser.add_argument("input", type=Path, help="Arquivo .ascii.txt de entrada")
    parser.add_argument("-o", "--output", type=Path, help="Arquivo de saída sanitizado")
    parser.add_argument("--report", type=Path, help="Arquivo JSON com o relatório de redacções")
    parser.add_argument("--stdout", action="store_true", help="Imprime o resultado sanitizado no stdout")
    args = parser.parse_args(argv)

    text = args.input.read_text(encoding="utf-8")
    sanitized, redactions = sanitize_ascii_text(text)

    if args.stdout:
        print(sanitized)
    else:
        out_path = args.output or args.input.with_suffix(".sanitized.txt")
        out_path.write_text(sanitized, encoding="utf-8")
        print(str(out_path))

    if args.report:
        args.report.write_text(
            json.dumps(
                {
                    "input": str(args.input),
                    "output": str(args.output or args.input.with_suffix(".sanitized.txt")),
                    "count": len(redactions),
                    "redactions": [asdict(r) for r in redactions],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
