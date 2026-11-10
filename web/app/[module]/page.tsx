'use client';
import {useParams} from 'next/navigation';

const modules:Record<string,{title:string;description:string}>={
  inbox:{title:'Inbox',description:'Caixa de entrada, mensagens, histórico e atendimento. A integração exige mapear eventos em tempo real e os comandos da API de conversas.'},
  contatos:{title:'Contatos e CRM',description:'Cadastro, etiquetas, perfil e relacionamento. A migração depende da paridade entre os contratos CRM legados e CRM V2.'},
  campanhas:{title:'Campanhas',description:'Rascunhos, destinatários, mídia, agendamento e execução. O módulo só será ativado após validar os fluxos e proteções de envio.'},
  'inteligencia-artificial':{title:'Inteligência artificial',description:'Provedores, credenciais, configurações e testes. Segredos permanecem no backend e não serão expostos ao navegador.'},
  treinamento:{title:'Treinamento',description:'Base de conhecimento, pacotes, mensagens aprovadas e prévias de treinamento.'},
  simulador:{title:'Simulador',description:'Simulação e avaliação do comportamento da IA.'},
  conexoes:{title:'Conexões',description:'Estado operacional, dispositivos e configurações dos canais.'},
  instancias:{title:'Instâncias',description:'Pareamento, QR Code, código de conexão e estado dos motores WhatsApp.'},
  canais:{title:'Canais',description:'Cadastro, permissões, execução e histórico dos canais.'},
  catalogo:{title:'Catálogo e recursos',description:'Produtos, PIX, documentos e biblioteca de recursos.'},
  audios:{title:'Biblioteca de áudios',description:'Arquivos de áudio, transcrição e preparação de mídia.'},
  historico:{title:'Histórico',description:'Consulta do histórico de conversas e mensagens.'},
  relatorios:{title:'Relatórios',description:'Indicadores e relatórios operacionais baseados em dados reais.'},
  contas:{title:'Contas',description:'Administração de contas e permissões, respeitando o perfil Admin Master.'},
  seguranca:{title:'Segurança',description:'PIN, políticas, alertas e configurações de segurança.'},
  configuracoes:{title:'Configurações',description:'Preferências e configurações gerais da conta.'}
};
export default function ModulePage(){const params=useParams<{module:string}>();const item=modules[params.module];if(!item)return <section className="surface panel"><h1>Módulo não encontrado</h1></section>;return <div><div className="heading"><div><p className="eyebrow">MODERNIZAÇÃO DO IENVIA</p><h1>{item.title}</h1><p className="description">{item.description}</p></div></div><section className="surface panel"><h2>Migração em andamento</h2><p>Esta rota já faz parte da navegação do novo frontend, mas sua interface operacional ainda não foi conectada. O módulo antigo continua preservado no painel de produção.</p><div className="notice">Nenhuma ação de envio, alteração ou exclusão está disponível nesta tela. Ela será liberada somente depois da integração e dos testes do contrato correspondente.</div></section></div>;}
