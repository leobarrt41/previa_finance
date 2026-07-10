# PROMPT DE SISTEMA — Módulo de Tradução de Faturas PDF para ASCII Posicional

## Objetivo
Você é um engenheiro de software especialista em processamento de documentos. Sua tarefa é implementar um módulo Python completo chamado `pdf_ascii_translator` que:

1. Recebe um PDF de fatura (pesquisável ou escaneado)
2. Solicita senha ao usuário se o PDF for protegido
3. Gera um arquivo `.ascii.txt` com o texto posicionado em uma grade de caracteres que preserva o layout visual aproximado do documento original
4. Sanitiza o ASCII localmente para remover PII/LGPD antes de qualquer envio externo
5. Passa o ASCII sanitizado para uma LLM que extrai campos estruturados da fatura
6. Salva os dados extraídos em banco de dados

---

## Regras de Arquitetura

- **Não use parsers de fatura prontos** (não use `invoice2data`, `pdfplumber` para extração semântica, nem regex hard-coded por fornecedor)
- O layout ASCII é a única "ponte" entre o PDF e a LLM — ele deve ser fiel o suficiente para que a LLM entenda a estrutura visual
- A sanitização de PII deve acontecer localmente, antes da chamada à API externa, com rotinas determinísticas e auditáveis
- A LLM recebe o ASCII sanitizado e decide sozinha quais campos extrair, sem regras predefinidas
- O módulo deve ser importável como biblioteca E executável como CLI

---

## Stack Obrigatória

```
Python 3.10+
pdfminer.six       — extração de texto com coordenadas exatas
pikepdf            — abertura de PDFs protegidos por senha
Pillow             — fallback para PDFs escaneados (imagem)
pytesseract        — OCR quando não há camada de texto
openai / requests  — chamada à LLM (configurável)
sqlalchemy         — persistência no banco
rich               — terminal interativo (progresso, prompts)
```

Instale com:
```bash
pip install pdfminer.six pikepdf Pillow pytesseract openai sqlalchemy rich
```

---

## Estrutura de Arquivos

```
pdf_ascii_translator/
├── __init__.py
├── extractor.py       # Extrai texto + coordenadas do PDF
├── grid.py            # Monta a grade ASCII posicional
├── sanitize_ascii.py   # Remove PII/LGPD do ASCII antes da LLM
├── password.py        # Lida com PDFs protegidos
├── llm.py             # Envia ASCII para LLM e recebe JSON estruturado
├── database.py        # Salva dados no banco via SQLAlchemy
├── cli.py             # Interface de linha de comando
└── main.py            # Ponto de entrada principal
```

---

## Módulo 1: `password.py`

```python
"""Abre PDFs com ou sem senha, solicitando interativamente quando necessário."""

import pikepdf
from rich.prompt import Prompt
from rich.console import Console

console = Console()

def open_pdf_with_password(pdf_path: str) -> pikepdf.Pdf:
    """
    Tenta abrir o PDF sem senha.
    Se falhar com PasswordError, solicita a senha ao usuário no terminal.
    Tenta até 3 vezes antes de abortar.
    """
    # Tentativa sem senha
    try:
        return pikepdf.open(pdf_path)
    except pikepdf.PasswordError:
        pass

    # PDF protegido — solicitar senha interativamente
    console.print(f"[yellow]🔒 O PDF '{pdf_path}' está protegido por senha.[/yellow]")

    for attempt in range(1, 4):
        password = Prompt.ask(f"  Senha (tentativa {attempt}/3)", password=True)
        try:
            pdf = pikepdf.open(pdf_path, password=password)
            console.print("[green]✓ PDF desbloqueado com sucesso.[/green]")
            return pdf
        except pikepdf.PasswordError:
            console.print(f"[red]✗ Senha incorreta.[/red]")

    raise RuntimeError("Número máximo de tentativas de senha atingido. Abortando.")
```

---

## Módulo 2: `extractor.py`

```python
"""Extrai itens de texto com coordenadas (x, y, texto) usando pdfminer.six."""

from dataclasses import dataclass
from typing import List, Tuple
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextBox, LTTextLine, LTChar, LTAnon, LAParams
import pikepdf
import tempfile, os

@dataclass
class TextItem:
    x: float        # coordenada horizontal (pt) a partir da esquerda
    y: float        # coordenada vertical (pt) a partir do TOPO da página
    text: str       # conteúdo do item
    font_size: float

@dataclass  
class PageData:
    page_number: int
    width: float    # largura da página em pontos (pt)
    height: float   # altura da página em pontos (pt)
    items: List[TextItem]


def extract_pages_data(pdf_path: str, password: str = "") -> List[PageData]:
    """
    Usa pdfminer para extrair texto com coordenadas de cada página.

    IMPORTANTE sobre coordenadas no PDF:
    - pdfminer retorna y a partir da BASE da página (0 = baixo)
    - Convertemos para y a partir do TOPO: y_topo = page_height - y_base
    Isso é necessário para montar a grade ASCII corretamente (linha 0 = topo).
    """
    laparams = LAParams(
        line_margin=0.3,
        word_margin=0.1,
        char_margin=1.5,
        all_texts=True
    )

    pages = []
    password_bytes = password.encode() if password else b""

    for page_num, page_layout in enumerate(
        extract_pages(pdf_path, password=password_bytes, laparams=laparams), start=1
    ):
        page_width  = page_layout.width
        page_height = page_layout.height
        items = []

        for element in page_layout:
            if isinstance(element, (LTTextBox, LTTextLine)):
                _extract_from_element(element, page_height, items)

        # Ordenar por posição: topo→baixo, esquerda→direita
        items.sort(key=lambda i: (round(i.y / 5) * 5, i.x))
        pages.append(PageData(page_number=page_num, width=page_width, height=page_height, items=items))

    return pages


def _extract_from_element(element, page_height: float, items: List[TextItem]):
    """Extrai recursivamente TextItems de um elemento pdfminer."""
    if isinstance(element, LTTextLine):
        text = element.get_text().strip()
        if text:
            # x0, y0 = canto inferior esquerdo do bounding box
            x = element.x0
            y_topo = page_height - element.y1  # converter para coordenada do topo
            font_size = element.height
            items.append(TextItem(x=x, y=y_topo, text=text, font_size=font_size))
    elif hasattr(element, '__iter__'):
        for child in element:
            _extract_from_element(child, page_height, items)
```

---

## Módulo 3: `grid.py`

```python
"""
Monta a grade ASCII posicional a partir dos TextItems extraídos.

CONCEITO CENTRAL:
- A página PDF é dividida em uma grade de células (col × row)
- Cada célula tem largura CELL_W pontos e altura CELL_H pontos
- O texto de cada TextItem é colocado na célula correspondente às suas coordenadas
- Células sem texto recebem o caractere de preenchimento (padrão: espaço)
- Regiões onde havia elementos gráficos recebem o caractere marcador (padrão: ¤)

O resultado é um arquivo de texto onde a POSIÇÃO VISUAL dos caracteres
reflete a posição real no documento original, permitindo que uma LLM
leia o layout como se estivesse "vendo" a página.
"""

from typing import List
from .extractor import PageData, TextItem

# Configurações da grade — ajuste conforme necessidade
CELL_W = 6.0    # pontos por coluna (menor = mais preciso, maior arquivo)
CELL_H = 10.0   # pontos por linha
FILL_CHAR = " " # caractere para células vazias
MASK_CHAR = "¤" # caractere para regiões não textuais (logos, tabelas, etc)
MIN_COLS = 80   # largura mínima da grade
MIN_ROWS = 40   # altura mínima da grade


def build_ascii_grid(page: PageData, cell_w=CELL_W, cell_h=CELL_H) -> List[str]:
    """
    Converte um PageData em uma lista de strings (linhas ASCII).

    Algoritmo:
    1. Calcular dimensões da grade a partir do tamanho da página
    2. Inicializar grade com FILL_CHAR
    3. Para cada TextItem, calcular a célula (row, col) e escrever o texto
    4. Resolver sobreposições: texto mais longo prevalece
    5. Retornar as linhas como strings, removendo espaços à direita
    """
    cols = max(MIN_COLS, int(page.width  / cell_w) + 1)
    rows = max(MIN_ROWS, int(page.height / cell_h) + 1)

    # Grade como lista de listas de chars
    grid = [[FILL_CHAR] * cols for _ in range(rows)]

    for item in page.items:
        col = int(item.x / cell_w)
        row = int(item.y / cell_h)

        # Garantir que estamos dentro dos limites
        row = max(0, min(row, rows - 1))
        col = max(0, min(col, cols - 1))

        # Escrever cada caractere do texto na grade
        for i, char in enumerate(item.text):
            target_col = col + i
            if target_col >= cols:
                break  # texto ultrapassa a borda — truncar
            # Somente sobrescrever se a célula estiver vazia
            if grid[row][target_col] == FILL_CHAR:
                grid[row][target_col] = char

    # Converter para strings, removendo trailing spaces
    return ["".join(row).rstrip() for row in grid]


def format_page_ascii(page: PageData, page_num: int, cell_w=CELL_W, cell_h=CELL_H) -> str:
    """Formata uma página completa com cabeçalho para o arquivo de saída."""
    lines = build_ascii_grid(page, cell_w, cell_h)
    cols = max(MIN_COLS, int(page.width / cell_w) + 1)
    rows_count = max(MIN_ROWS, int(page.height / cell_h) + 1)

    header = (
        f"{'='*70}\n"
        f"PAGE {page_num} | "
        f"size={page.width:.0f}x{page.height:.0f}pt | "
        f"grid={cols}x{rows_count} | "
        f"items={len(page.items)}\n"
        f"{'='*70}"
    )
    body = "\n".join(lines)
    return f"{header}\n{body}"


def pages_to_ascii_file(pages_data: List[PageData], output_path: str):
    """
    Recebe lista de PageData e grava o arquivo ASCII completo.

    Formato de saída:
    ======================================================================
    PAGE 1 | size=595x842pt | grid=99x84 | items=47
    ======================================================================
    <conteúdo ASCII da página 1>

    ======================================================================
    PAGE 2 | ...
    """
    with open(output_path, "w", encoding="utf-8") as f:
        for page in pages_data:
            ascii_block = format_page_ascii(page, page.page_number)
            f.write(ascii_block + "\n\n")

    return output_path
```

---

## Módulo 3.5: `sanitize_ascii.py`

```python
"""
Remove dados pessoais do ASCII posicional antes de enviá-lo à LLM.

Regras mínimas:
- mascarar CPF, CNPJ, CEP, e-mail, telefone, PIX e cartões
- mascarar valores ligados a rótulos como nome, titular, cliente, endereço
- preservar o layout sempre que possível, mantendo o texto redigido localmente
"""

from pathlib import Path
from typing import Sequence

def sanitize_ascii_text(text: str) -> tuple[str, list[dict]]:
    ...

def sanitize_ascii_file(input_path: Path, output_path: Path | None = None) -> Path:
    ...
```

Uso no pipeline:

```text
PDF -> ASCII bruto -> sanitize_ascii.py -> ASCII sanitizado -> LLM -> JSON -> banco
```

---

## Módulo 4: `llm.py`

```python
"""
Envia o conteúdo ASCII para uma LLM e recebe os dados estruturados da fatura.

A LLM recebe o arquivo ASCII completo e retorna um JSON com os campos da fatura.
NÃO há regex, NÃO há regras por fornecedor — a LLM decide o que extrair.
"""

import json
import os
from typing import Dict, Any

# Compatível com OpenAI, Ollama (openai-compatible), LM Studio, etc.
# Configurar via variáveis de ambiente:
#   LLM_BASE_URL=http://localhost:11434/v1   (para Ollama)
#   LLM_API_KEY=ollama
#   LLM_MODEL=llama3.1:8b

try:
    from openai import OpenAI
    _client = OpenAI(
        base_url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"),
        api_key=os.getenv("LLM_API_KEY", "ollama"),
    )
    _model = os.getenv("LLM_MODEL", "llama3.1:8b")
except ImportError:
    _client = None


SYSTEM_PROMPT = """Você é um extrator de dados de faturas. 
Receberá o conteúdo de uma fatura representado como texto ASCII posicional,
onde a posição dos caracteres no arquivo reflete a posição visual no documento original.

Analise o layout e extraia todos os campos relevantes da fatura.
Retorne SOMENTE um objeto JSON válido, sem texto adicional, sem markdown.

Campos a extrair (inclua apenas os que existirem no documento):
{
  "numero_fatura": "",
  "data_emissao": "",
  "data_vencimento": "",
  "fornecedor": {
    "nome": "",
    "cnpj_cpf": "",
    "endereco": "",
    "telefone": "",
    "email": ""
  },
  "cliente": {
    "nome": "",
    "cnpj_cpf": "",
    "endereco": ""
  },
  "itens": [
    {
      "descricao": "",
      "quantidade": "",
      "unidade": "",
      "valor_unitario": "",
      "valor_total": ""
    }
  ],
  "subtotal": "",
  "impostos": [],
  "desconto": "",
  "total": "",
  "moeda": "",
  "forma_pagamento": "",
  "chave_pix": "",
  "banco": "",
  "observacoes": ""
}

Regras:
- Preserve o formato original de valores monetários (ex: "1.234,56" ou "1234.56")
- Datas no formato encontrado no documento
- Se um campo não existir, omita-o do JSON
- Para itens em tabela, use a posição visual das colunas para separar os campos
"""


def extract_invoice_data(ascii_content: str) -> Dict[str, Any]:
    """
    Envia o conteúdo ASCII para a LLM e retorna o JSON estruturado.

    Parâmetros:
        ascii_content: string com o conteúdo completo do arquivo .ascii.txt

    Retorna:
        dict com os campos da fatura
    """
    if _client is None:
        raise ImportError("openai não instalado. Execute: pip install openai")

    response = _client.chat.completions.create(
        model=_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"Extraia os dados desta fatura:\n\n{ascii_content}"}
        ],
        temperature=0.0,  # determinístico — queremos extração, não criatividade
        response_format={"type": "json_object"},  # forçar JSON (suportado por OpenAI e alguns locais)
    )

    raw = response.choices[0].message.content.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: tentar extrair JSON do texto
        import re
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"LLM não retornou JSON válido.\nResposta: {raw[:500]}")
```

---

## Módulo 5: `database.py`

```python
"""Persiste os dados extraídos no banco via SQLAlchemy."""

import json
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Float
from sqlalchemy.orm import DeclarativeBase, Session

DATABASE_URL = "sqlite:///faturas.db"  # Trocar para PostgreSQL em produção
engine = create_engine(DATABASE_URL, echo=False)


class Base(DeclarativeBase):
    pass


class Fatura(Base):
    __tablename__ = "faturas"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    arquivo_origem   = Column(String(500))
    numero_fatura    = Column(String(100))
    data_emissao     = Column(String(50))
    data_vencimento  = Column(String(50))
    fornecedor_nome  = Column(String(300))
    fornecedor_cnpj  = Column(String(50))
    cliente_nome     = Column(String(300))
    cliente_cnpj     = Column(String(50))
    total            = Column(String(50))
    moeda            = Column(String(20))
    forma_pagamento  = Column(String(200))
    dados_completos  = Column(Text)   # JSON completo retornado pela LLM
    arquivo_ascii    = Column(String(500))
    processado_em    = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(engine)


def save_invoice(data: dict, arquivo_origem: str, arquivo_ascii: str) -> int:
    """
    Salva os dados da fatura no banco.
    Retorna o ID do registro criado.
    """
    fornecedor = data.get("fornecedor", {})
    cliente    = data.get("cliente", {})

    fatura = Fatura(
        arquivo_origem  = arquivo_origem,
        numero_fatura   = data.get("numero_fatura", ""),
        data_emissao    = data.get("data_emissao", ""),
        data_vencimento = data.get("data_vencimento", ""),
        fornecedor_nome = fornecedor.get("nome", ""),
        fornecedor_cnpj = fornecedor.get("cnpj_cpf", ""),
        cliente_nome    = cliente.get("nome", ""),
        cliente_cnpj    = cliente.get("cnpj_cpf", ""),
        total           = data.get("total", ""),
        moeda           = data.get("moeda", "BRL"),
        forma_pagamento = data.get("forma_pagamento", ""),
        dados_completos = json.dumps(data, ensure_ascii=False),
        arquivo_ascii   = arquivo_ascii,
    )

    with Session(engine) as session:
        session.add(fatura)
        session.commit()
        return fatura.id
```

---

## Módulo 6: `main.py` (orquestrador)

```python
"""
Pipeline completo:
PDF → senha (se necessário) → ASCII posicional → sanitização → LLM → JSON → Banco de dados
"""

import os
from pathlib import Path
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.panel import Panel
from rich.table import Table
import json

from .password   import open_pdf_with_password
from .extractor  import extract_pages_data
from .grid       import pages_to_ascii_file
from .sanitize_ascii import sanitize_ascii_file
from .llm        import extract_invoice_data
from .database   import save_invoice

console = Console()


def process_invoice(pdf_path: str, output_dir: str = None, save_to_db: bool = True) -> dict:
    """
    Pipeline principal de processamento de uma fatura.

    Parâmetros:
        pdf_path:    caminho para o arquivo PDF
        output_dir:  onde salvar o .ascii.txt (padrão: mesmo diretório do PDF)
        save_to_db:  se True, persiste no banco de dados

    Retorna:
        dict com os dados extraídos pela LLM
    """
    pdf_path = str(Path(pdf_path).resolve())
    output_dir = output_dir or str(Path(pdf_path).parent)
    base_name  = Path(pdf_path).stem
    ascii_path = str(Path(output_dir) / f"{base_name}.ascii.txt")

    console.print(Panel(
        f"[bold]Processando fatura:[/bold] {Path(pdf_path).name}",
        style="blue"
    ))

    # ── ETAPA 1: Abrir PDF (com senha se necessário) ──────────────────────────
    with Progress(SpinnerColumn(), TextColumn("{task.description}"), transient=True) as p:
        p.add_task("Abrindo PDF...", total=None)
        pdf = open_pdf_with_password(pdf_path)

    console.print(f"  [green]✓[/green] PDF aberto — {len(pdf.pages)} página(s)")

    # Salvar PDF desbloqueado em temp para o pdfminer ler
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
        pdf.save(tmp_path)

    try:
        # ── ETAPA 2: Extrair texto com coordenadas ────────────────────────────
        with Progress(SpinnerColumn(), TextColumn("{task.description}"), transient=True) as p:
            p.add_task("Extraindo texto e coordenadas...", total=None)
            pages_data = extract_pages_data(tmp_path)

        total_items = sum(len(p.items) for p in pages_data)
        console.print(f"  [green]✓[/green] {total_items} elementos de texto extraídos")

        # ── ETAPA 3: Montar grade ASCII posicional ────────────────────────────
        with Progress(SpinnerColumn(), TextColumn("{task.description}"), transient=True) as p:
            p.add_task("Montando grade ASCII...", total=None)
            pages_to_ascii_file(pages_data, ascii_path)

        ascii_size = Path(ascii_path).stat().st_size
        console.print(f"  [green]✓[/green] ASCII gerado → {ascii_path} ({ascii_size:,} bytes)")

    finally:
        os.unlink(tmp_path)

        # ── ETAPA 4: Sanitizar ASCII localmente antes da LLM ─────────────────────
        console.print("  [yellow]⟳[/yellow] Sanitizando ASCII localmente...")
        sanitized_path = str(Path(output_dir) / f"{base_name}.sanitized.txt")
        sanitize_ascii_file(Path(ascii_path), Path(sanitized_path))
        console.print(f"  [green]✓[/green] ASCII sanitizado → {sanitized_path}")

    # O ASCII bruto é artefato transitório e pode ser removido após a sanitização.
    try:
        Path(ascii_path).unlink()
    except FileNotFoundError:
        pass

        # ── ETAPA 5: Enviar ASCII sanitizado para LLM ────────────────────────────
        console.print("  [yellow]⟳[/yellow] Enviando para LLM...")
    with open(sanitized_path, encoding="utf-8") as f:
        ascii_content = f.read()

    invoice_data = extract_invoice_data(ascii_content)
    console.print(f"  [green]✓[/green] Dados extraídos pela LLM")

        # ── ETAPA 6: Mostrar resultado ────────────────────────────────────────────
        _print_summary(invoice_data)

    # ── ETAPA 7: Salvar no banco ──────────────────────────────────────────────
    if save_to_db:
        record_id = save_invoice(invoice_data, pdf_path, sanitized_path)
        console.print(f"  [green]✓[/green] Salvo no banco de dados — ID: {record_id}")

    return invoice_data


def _print_summary(data: dict):
    """Exibe um resumo visual dos dados extraídos no terminal."""
    table = Table(title="Dados Extraídos", show_header=True, header_style="bold cyan")
    table.add_column("Campo", style="dim", width=25)
    table.add_column("Valor")

    fields = [
        ("Nº Fatura",       data.get("numero_fatura", "-")),
        ("Data Emissão",     data.get("data_emissao", "-")),
        ("Data Vencimento",  data.get("data_vencimento", "-")),
        ("Fornecedor",       data.get("fornecedor", {}).get("nome", "-")),
        ("CNPJ Fornecedor",  data.get("fornecedor", {}).get("cnpj_cpf", "-")),
        ("Cliente",          data.get("cliente", {}).get("nome", "-")),
        ("Total",            data.get("total", "-")),
        ("Moeda",            data.get("moeda", "-")),
        ("Forma Pagamento",  data.get("forma_pagamento", "-")),
    ]

    for campo, valor in fields:
        table.add_row(campo, str(valor))

    itens = data.get("itens", [])
    if itens:
        table.add_row("Itens", f"{len(itens)} item(ns)")

    console.print(table)
```

---

## Módulo 7: `cli.py`

```python
"""Interface de linha de comando."""

import argparse
import sys
import json
from pathlib import Path
from .main import process_invoice


def main():
    parser = argparse.ArgumentParser(
        description="Tradutor de Faturas PDF → ASCII → Sanitização → LLM → Banco de Dados",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  # Processar uma fatura e salvar no banco
  python -m pdf_ascii_translator fatura.pdf

  # Gerar apenas o ASCII, sem chamar a LLM
  python -m pdf_ascii_translator fatura.pdf --only-ascii

  # Sanitizar um ASCII gerado anteriormente
  python docs/tradutor\ de\ faturas\ /sanitize_ascii.py saida.ascii.txt --report redacoes.json

  # Especificar diretório de saída
  python -m pdf_ascii_translator fatura.pdf --output ./saidas/

  # Processar em batch
  python -m pdf_ascii_translator *.pdf
        """
    )
    parser.add_argument("pdfs", nargs="+", help="Arquivo(s) PDF para processar")
    parser.add_argument("--output",     "-o", help="Diretório de saída para os arquivos ASCII")
    parser.add_argument("--only-ascii", "-a", action="store_true", help="Gerar apenas o ASCII, sem chamar a LLM")
    parser.add_argument("--no-db",            action="store_true", help="Não salvar no banco de dados")
    parser.add_argument("--json-out",   "-j", help="Salvar resultado JSON neste arquivo")
    parser.add_argument("--model",      "-m", help="Modelo LLM a usar (sobrescreve LLM_MODEL env)")

    args = parser.parse_args()

    if args.model:
        import os
        os.environ["LLM_MODEL"] = args.model

    results = []
    for pdf_path in args.pdfs:
        if not Path(pdf_path).exists():
            print(f"ERRO: arquivo não encontrado: {pdf_path}", file=sys.stderr)
            continue

        if args.only_ascii:
            # Modo simplificado: só gera o ASCII
            from .password  import open_pdf_with_password
            from .extractor import extract_pages_data
            from .grid      import pages_to_ascii_file
            import tempfile, os

            pdf = open_pdf_with_password(pdf_path)
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp_path = tmp.name
                pdf.save(tmp_path)
            try:
                pages = extract_pages_data(tmp_path)
                out   = str(Path(args.output or Path(pdf_path).parent) / (Path(pdf_path).stem + ".ascii.txt"))
                pages_to_ascii_file(pages, out)
                print(f"ASCII gerado: {out}")
                from .sanitize_ascii import sanitize_ascii_file
                sanitized_out = str(Path(args.output or Path(pdf_path).parent) / (Path(pdf_path).stem + ".sanitized.txt"))
                sanitize_ascii_file(Path(out), Path(sanitized_out))
                try:
                    os.unlink(out)
                except FileNotFoundError:
                    pass
                print(f"ASCII sanitizado: {sanitized_out}")
            finally:
                os.unlink(tmp_path)
        else:
            data = process_invoice(pdf_path, output_dir=args.output, save_to_db=not args.no_db)
            results.append(data)

    if args.json_out and results:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(results if len(results) > 1 else results[0], f, ensure_ascii=False, indent=2)
        print(f"JSON salvo em: {args.json_out}")


if __name__ == "__main__":
    main()
```

---

## `__init__.py`

```python
from .main import process_invoice
from .grid import pages_to_ascii_file, build_ascii_grid
from .extractor import extract_pages_data
from .database import save_invoice

__all__ = ["process_invoice", "pages_to_ascii_file", "build_ascii_grid", "extract_pages_data", "save_invoice"]
```

---

## Configuração de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# LLM — Ollama local (padrão)
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.1:8b

# Para OpenAI
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_API_KEY=sk-...
# LLM_MODEL=gpt-4o

# Banco de dados
DATABASE_URL=sqlite:///faturas.db
# DATABASE_URL=postgresql://user:pass@localhost/faturas
```

Carregue com:
```python
from dotenv import load_dotenv
load_dotenv()
```

---

## Como Usar Como Biblioteca

```python
from pdf_ascii_translator import process_invoice

# Pipeline completo: PDF → ASCII → Sanitização → LLM → banco
result = process_invoice("nota_fiscal.pdf")
print(result["total"])
print(result["fornecedor"]["cnpj_cpf"])

# Apenas gerar o ASCII (sem LLM)
from pdf_ascii_translator import extract_pages_data, pages_to_ascii_file
pages = extract_pages_data("nota_fiscal.pdf")
pages_to_ascii_file(pages, "saida.ascii.txt")
```

---

## Fluxo de Dados

```
PDF (com ou sem senha)
        │
        ▼ password.py (pikepdf)
PDF desbloqueado (temporário)
        │
        ▼ extractor.py (pdfminer.six)
List[PageData]  ←  TextItem(x, y, text, font_size)
        │
        ▼ grid.py
Grade ASCII posicional (.ascii.txt)
  "PAGE 1 | size=595x842pt | grid=99x84"
  "   NOTA FISCAL Nº 12345"
  "   Emissão: 01/06/2026"
  "   Fornecedor: ACME LTDA"
  "   ¤¤¤¤¤¤¤¤¤¤¤¤¤ [logo] ¤¤¤¤¤¤¤¤"
        │
        ▼ sanitize_ascii.py
ASCII sanitizado (.sanitized.txt)
        │
        ▼ llm.py (OpenAI API / Ollama)
JSON estruturado:
  {
    "numero_fatura": "12345",
    "fornecedor": {"nome": "ACME LTDA", "cnpj_cpf": "00.000.000/0001-00"},
    "total": "1.234,56",
    ...
  }
        │
        ▼ database.py (SQLAlchemy)
Tabela `faturas` no banco de dados
```

---

## Notas de Implementação

1. **PDFs escaneados (sem camada de texto):** `extract_pages_data` retornará lista vazia. Implemente fallback com `pytesseract` — converta cada página para imagem com `pdf2image`, aplique OCR e use as coordenadas retornadas pelo tesseract (`image_to_data` com `output_type=dict`).

2. **Ajuste de CELL_W / CELL_H:** Para faturas com texto muito pequeno, reduza para `CELL_W=4, CELL_H=8`. Para documentos esparsos, `CELL_W=8, CELL_H=12` gera arquivos menores.

3. **Contexto da LLM:** Se a fatura tiver muitas páginas e ultrapassar o contexto do modelo, processe página por página e mescle os JSONs resultantes.

4. **Validação pós-extração:** Após receber o JSON da LLM, aplique validações determinísticas: conferir dígitos verificadores do CNPJ, somar itens e comparar com o total, validar formato de datas.
