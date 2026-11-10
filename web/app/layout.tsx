import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/app-shell';
import './globals.css';
export const metadata: Metadata = { title:'Ienvia — Atendimento inteligente', description:'Atendimento, vendas e relacionamento em um só lugar.', applicationName:'Ienvia' };
export const viewport: Viewport = { width:'device-width', initialScale:1, themeColor:'#101b31' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR"><body><AppShell>{children}</AppShell></body></html>; }
