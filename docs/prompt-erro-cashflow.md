# Problema: Erro de Lógica na Projeção de CashFlow

## Contexto
O sistema de projeção de fluxo de caixa (CashFlow) está exibindo cartões como "Cartão desconhecido" e/ou apresentando inconsistências nos valores de "Valor pago" e "Total da fatura" na tela de faturas do mês atual. O cálculo do saldo aberto, valor pago e identificação dos cartões não está batendo com o esperado após a importação de extratos OFX.

## Sintomas
- Cartões aparecem como "Cartão desconhecido" na tabela de faturas do mês.
- O campo "Valor pago" pode ser maior que o "Total da fatura" ou não corresponde ao valor realmente pago.
- O campo "Total da fatura" pode não refletir corretamente as compras do mês.
- O saldo aberto não está correto em relação ao que foi pago ou deixado em aberto.

## Fluxo Esperado
1. Cada fatura de cartão deve ser corretamente identificada (instituição, final do cartão, etc).
2. O valor pago deve ser igual ou menor que o total da fatura, refletindo pagamentos parciais ou integrais.
3. O saldo aberto deve ser o valor da fatura não quitado, levado para o mês seguinte.
4. A associação entre pagamentos no extrato e faturas deve considerar valor, data e referência textual (MEMO, NAME, etc).

## Possíveis Causas
- Falha na associação entre transações de pagamento e faturas (heurística insuficiente ou não usando o campo memo).
- Falta de identificação do cartão ao importar faturas ou pagamentos.
- Duplicidade ou erro de cálculo ao somar valores pagos.
- Falta de persistência ou uso do campo memo para identificar pagamentos.

## Exemplo de Tela
(Anexar print da tela com o erro, se possível)

## Observações
- O campo memo já está sendo salvo na tabela de transações.
- O parser de OFX foi ajustado para persistir o campo memo.
- As migrations já foram aplicadas.

## O que precisa ser resolvido
- Corrigir a lógica de associação entre pagamentos e faturas para garantir identificação correta do cartão e valores coerentes.
- Garantir que cartões sejam identificados corretamente na UI.
- Ajustar cálculo de valor pago, total da fatura e saldo aberto conforme as regras de negócio.

---

> Detalhe o fluxo de dados, heurísticas e pontos de decisão que podem estar causando o erro. Sugira pontos de investigação e possíveis correções.