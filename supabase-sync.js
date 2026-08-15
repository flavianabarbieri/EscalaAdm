/*
  Sincronizacao online da EscalaAdm com Supabase.
  Este arquivo foi feito para ser carregado DEPOIS do script principal do index.html.
*/
(() => {
  'use strict';

  const SUPABASE_URL_SYNC = 'https://nfjbgwrogpzuhgufpxol.supabase.co';
  const SUPABASE_KEY_SYNC = 'sb_publishable_RJX0v05NZhfZ0ondeE63WQ_YDwsogLz';
  const ID_ESCALA_ONLINE_SYNC = 'escala_adm';
  const URL_DADOS_ONLINE_SYNC = `${SUPABASE_URL_SYNC}/rest/v1/escalas_publicas`;
  const CHAVE_ANIVERSARIOS_ONLINE = '__aniversariosRecorrentes';

  let carregamentoEmAndamento = false;
  let ultimaCargaOnline = 0;

  function cabecalhosSupabase(prefer = '') {
    const headers = {
      apikey: SUPABASE_KEY_SYNC,
      Authorization: `Bearer ${SUPABASE_KEY_SYNC}`,
      'Content-Type': 'application/json'
    };
    if (prefer) headers.Prefer = prefer;
    return headers;
  }

  function cloneSeguro(valor, fallback = {}) {
    try {
      return structuredClone(valor ?? fallback);
    } catch {
      try { return JSON.parse(JSON.stringify(valor ?? fallback)); }
      catch { return fallback; }
    }
  }

  function normalizarEquipeParaVersaoAtual(equipe) {
    const copia = cloneSeguro(equipe, {});
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    Object.values(copia).forEach(cadastro => {
      if (!cadastro || typeof cadastro !== 'object') return;
      if (!cadastro.cargaHoraria) cadastro.cargaHoraria = 'mesma';

      // Compatibilidade com a versao anterior que aceitava varios periodos.
      if ((!cadastro.feriasInicio || Number(cadastro.feriasDias) < 1) && Array.isArray(cadastro.feriasPeriodos)) {
        const periodos = cadastro.feriasPeriodos
          .filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(String(p.inicio || '')) && Number(p.dias) > 0)
          .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

        if (periodos.length) {
          const escolhido = periodos.find(p => {
            const [a, m, d] = p.inicio.split('-').map(Number);
            const fim = new Date(a, m - 1, d + Number(p.dias) - 1);
            fim.setHours(0, 0, 0, 0);
            return fim >= hoje;
          }) || periodos.at(-1);

          cadastro.feriasInicio = escolhido.inicio;
          cadastro.feriasDias = Number(escolhido.dias) || 0;
        }
      }

      // A pagina atual trabalha com um periodo por colaborador.
      delete cadastro.feriasPeriodos;
      cadastro.feriasInicio = cadastro.feriasInicio || '';
      cadastro.feriasDias = Number(cadastro.feriasDias) || 0;
    });

    return copia;
  }

  function montarAnotacoesOnline() {
    const dados = cloneSeguro(anotacoesDatas, {});
    dados[CHAVE_ANIVERSARIOS_ONLINE] = cloneSeguro(aniversariosRecorrentes, {});
    return dados;
  }

  function extrairAnotacoesOnline(dados) {
    const copia = cloneSeguro(dados, {});
    const aniversariosSalvos = cloneSeguro(copia[CHAVE_ANIVERSARIOS_ONLINE], {});
    delete copia[CHAVE_ANIVERSARIOS_ONLINE];

    // Migra aniversarios antigos que estavam gravados apenas na data completa.
    Object.entries(copia).forEach(([data, texto]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
      if (typeof ehAniversario === 'function' && ehAniversario(texto)) {
        aniversariosSalvos[data.slice(5)] = texto;
      }
    });

    return { anotacoes: copia, aniversarios: aniversariosSalvos };
  }

  function persistirLocal() {
    localStorage.setItem(CHAVE_EQUIPE, JSON.stringify(configEquipe));
    localStorage.setItem(CHAVE_ANOTACOES, JSON.stringify(anotacoesDatas));
    localStorage.setItem(CHAVE_ANIVERSARIOS, JSON.stringify(aniversariosRecorrentes));
  }

  async function salvarDadosOnline(mostrarSucesso = false) {
    try {
      const resposta = await fetch(`${URL_DADOS_ONLINE_SYNC}?on_conflict=id`, {
        method: 'POST',
        headers: cabecalhosSupabase('resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify({
          id: ID_ESCALA_ONLINE_SYNC,
          equipe: normalizarEquipeParaVersaoAtual(configEquipe),
          anotacoes: montarAnotacoesOnline(),
          updated_at: new Date().toISOString()
        })
      });

      if (!resposta.ok) throw new Error(await resposta.text());
      if (mostrarSucesso) alert('Dados atuais enviados para o Supabase com sucesso. Agora o celular pode abrir a escala normalmente.');
      return true;
    } catch (erro) {
      console.error('Falha ao sincronizar a EscalaAdm:', erro);
      alert('A alteracao ficou salva neste aparelho, mas nao foi possivel sincronizar com o Supabase agora. Verifique a internet e tente novamente.');
      return false;
    }
  }

  async function carregarDadosOnline({ silencioso = true } = {}) {
    if (carregamentoEmAndamento) return false;
    carregamentoEmAndamento = true;

    try {
      const resposta = await fetch(
        `${URL_DADOS_ONLINE_SYNC}?id=eq.${encodeURIComponent(ID_ESCALA_ONLINE_SYNC)}&select=equipe,anotacoes,updated_at`,
        { headers: cabecalhosSupabase() }
      );

      if (!resposta.ok) throw new Error(await resposta.text());
      const [registro] = await resposta.json();

      if (!registro) {
        if (!silencioso) alert('Ainda nao existe um registro online da EscalaAdm. Abra primeiro no computador correto usando ?migrar=1.');
        return false;
      }

      if (registro.equipe && Object.keys(registro.equipe).length) {
        configEquipe = normalizarEquipeParaVersaoAtual(registro.equipe);
      }

      const extraido = extrairAnotacoesOnline(registro.anotacoes || {});
      anotacoesDatas = extraido.anotacoes;
      aniversariosRecorrentes = extraido.aniversarios;

      // Mantem a observacao fixa que ja existe na versao atual.
      if (!anotacoesDatas['2026-10-03']) anotacoesDatas['2026-10-03'] = 'Casamento Stefanie';

      persistirLocal();
      preencherPessoas(pessoa.value);
      if (typeof preencherFeriasPessoa === 'function' && !painelFerias.hidden) preencherFeriasPessoa(feriasPessoa.value);
      renderizar();
      ultimaCargaOnline = Date.now();
      return true;
    } catch (erro) {
      console.error('Falha ao carregar a EscalaAdm do Supabase:', erro);
      if (!silencioso) alert('Nao foi possivel carregar os dados online agora. A escala continuara usando os dados salvos neste aparelho.');
      return false;
    } finally {
      carregamentoEmAndamento = false;
    }
  }

  function ligarSalvamentoAutomatico(seletor) {
    const elemento = document.querySelector(seletor);
    if (!elemento) return;
    elemento.addEventListener('click', () => {
      // O listener original da pagina roda primeiro e atualiza as variaveis/localStorage.
      setTimeout(() => salvarDadosOnline(false), 0);
    });
  }

  async function inicializarSincronizacao() {
    const params = new URLSearchParams(location.search);
    const migrar = params.get('migrar') === '1';

    if (migrar) {
      // Use somente no computador que possui os dados corretos/mais atuais.
      const ok = await salvarDadosOnline(true);
      if (ok) {
        params.delete('migrar');
        const novaQuery = params.toString();
        history.replaceState(null, '', `${location.pathname}${novaQuery ? `?${novaQuery}` : ''}${location.hash}`);
      }
    } else {
      await carregarDadosOnline({ silencioso: true });
    }

    // Sincroniza todas as operacoes que ja salvam no localStorage da pagina atual.
    [
      '#btnSalvar',
      '#btnSalvarFerias',
      '#btnLimparFerias',
      '#btnSalvarAnotacao',
      '#btnExcluirAnotacao'
    ].forEach(ligarSalvamentoAutomatico);

    // Ao voltar para a aba/app, busca alteracoes feitas em outro aparelho.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultimaCargaOnline < 5000) return;
      carregarDadosOnline({ silencioso: true });
    });

    window.addEventListener('focus', () => {
      if (Date.now() - ultimaCargaOnline < 5000) return;
      carregarDadosOnline({ silencioso: true });
    });
  }

  inicializarSincronizacao();
})();
