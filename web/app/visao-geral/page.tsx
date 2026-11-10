'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { clearAuth, readAuth } from '@/lib/auth';

type Summary = Record<string, unknown>;

export default function OverviewPage() {
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!readAuth()) { router.replace('/login'); return; }
    const onUnauthorized = () => { clearAuth(); router.replace('/login'); };
    window.addEventListener('ienvia:unauthorized', onUnauthorized);
    api<Summary>('dashboard/summary').then(setData).catch(e => setError(e instanceof Error ? e.message : 'Falha ao carregar a visão geral.')).finally(()=>setLoading(false));
    return () => window.removeEventListener('ienvia:unauthorized', onUnauthorized);
  }, [router]);

  const fields = data ? Object.entries(data).filter(([,value]) => ['string','number'].includes(typeof value)).slice(0,12) : [];
  return <div>
    <div className="heading"><div><p className="eyebrow">SEU NEGÓCIO EM UM SÓ LUGAR</p><h1>Visão geral</h1><p className="description">Acompanhe a operação e os indicadores da sua conta.</p></div></div>
    {loading && <div className="surface loading">Carregando indicadores da sua conta…</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {!loading && !error && <section className="surface panel"><h2>Resumo operacional</h2><p>Dados recebidos diretamente do backend do Ienvia.</p>
      {fields.length ? <div className="metrics">{fields.map(([key,value])=><article className="surface metric" key={key}><div className="metric-label">{key.replace(/([A-Z])/g,' $1').replace(/[_-]/g,' ')}</div><div className="metric-value">{String(value)}</div></article>)}</div> : <div className="empty">A API respondeu, mas não retornou indicadores simples para exibição. O contrato detalhado do resumo precisa ser mapeado para montar os cartões definitivos.</div>}
    </section>}
    <div className="notice">Esta é a primeira fundação funcional. Os módulos serão conectados individualmente após validação dos contratos e permissões.</div>
  </div>;
}
