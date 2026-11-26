import { Suspense, lazy, useEffect, useState } from 'react';
import { ROLE_LABEL, can } from '../shared/types';
import { Link, matchPath, navigate, useLocation } from './router';
import { AppProvider, useApp } from './store';
import { Icon, type IconName, Loading, ToastProvider } from './ui';
import LoginPage, { Logo } from './pages/Login';
import PasswordPage from './pages/Password';

const MapPage = lazy(() => import('./pages/MapPage'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const PolesPage = lazy(() => import('./pages/Poles'));
const TasksPage = lazy(() => import('./pages/Tasks'));
const UsersPage = lazy(() => import('./pages/Users'));
const AuditPage = lazy(() => import('./pages/Audit'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <Root />
      </AppProvider>
    </ToastProvider>
  );
}

function Root() {
  const { user } = useApp();
  if (user === undefined) return <div className="flex h-full items-center justify-center"><Loading /></div>;
  if (!user) return <LoginPage />;
  if (user.must_change_password) return <PasswordPage forced />;
  return <Shell />;
}

interface NavItem { to: string; label: string; icon: IconName; show: boolean }

function Shell() {
  const { user, logout } = useApp();
  const { path } = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const role = user!.role;
  const nav: NavItem[] = [
    { to: '/', label: 'Peta 3D', icon: 'cube', show: true },
    { to: '/dashboard', label: 'Dashboard', icon: 'chart', show: true },
    { to: '/tiang', label: 'Senarai Tiang', icon: 'list', show: true },
    { to: '/tugasan', label: 'Tugasan', icon: 'tasks', show: true },
    { to: '/pengguna', label: 'Pengguna & Tetapan', icon: 'users', show: can(role, 'user.manage') },
    { to: '/audit', label: 'Audit Log', icon: 'shield', show: can(role, 'audit.view') },
  ].filter((n) => n.show) as NavItem[];
  const active = (to: string) => (to === '/' ? path === '/' : path.startsWith(to));

  let page: React.ReactNode;
  let m: Record<string, string> | null;
  if (path === '/') page = <MapPage />;
  else if (path === '/dashboard') page = <DashboardPage />;
  else if (path === '/tiang') page = <PolesPage />;
  else if ((m = matchPath('/tiang/:id', path))) page = <ProfilePage id={Number(m.id)} />;
  else if ((m = matchPath('/t/:code', path))) page = <ProfilePage tag={m.code} />;
  else if (path === '/tugasan') page = <TasksPage />;
  else if (path === '/pengguna' && can(role, 'user.manage')) page = <UsersPage />;
  else if (path === '/audit' && can(role, 'audit.view')) page = <AuditPage />;
  else if (path === '/akaun') page = <PasswordPage />;
  else page = <NotFound />;

  const userCard = (
    <div className="border-t border-white/10 p-3">
      <Link to="/akaun" className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-white/10">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-volt-400 text-sm font-bold text-navy-950">{user!.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{user!.name}</span>
          <span className="block text-[11px] text-volt-300">{ROLE_LABEL[role]}</span>
        </span>
      </Link>
      <button type="button" onClick={logout} className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white">
        <Icon name="logout" size={16} /> Log keluar
      </button>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Sidebar desktop */}
      <aside className="no-print hidden w-60 shrink-0 flex-col bg-navy-950 md:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Logo size={34} />
          <div className="leading-tight">
            <div className="text-sm font-bold text-white">Revotech</div>
            <div className="text-[11px] text-slate-400">Asset Tag Manager</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} aria-current={active(n.to) ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${active(n.to) ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
              <Icon name={n.icon} className={active(n.to) ? 'text-volt-400' : ''} />
              {n.label}
            </Link>
          ))}
        </nav>
        {userCard}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Bar atas mudah alih */}
        <header className="no-print flex items-center justify-between bg-navy-950 px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <Logo size={28} />
            <span className="text-sm font-bold text-white">Revotech ATM</span>
          </div>
          <button type="button" aria-label="Menu" onClick={() => setMenu(true)} className="rounded-lg p-2 text-white hover:bg-white/10">
            <Icon name="menu" />
          </button>
        </header>
        <main className="print-full relative min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={<Loading />}>{page}</Suspense>
        </main>
        {/* Tab bawah mudah alih */}
        <nav className="no-print grid grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {nav.slice(0, 4).map((n) => (
            <Link key={n.to} to={n.to} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${active(n.to) ? 'text-navy-800' : 'text-slate-400'}`}>
              <Icon name={n.icon} size={20} />
              {n.label.replace('Senarai ', '')}
            </Link>
          ))}
        </nav>
      </div>

      {menu && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMenu(false)}>
          <div className="absolute inset-0 bg-navy-950/60" />
          <div className="anim-slide absolute inset-y-0 right-0 flex w-64 flex-col bg-navy-950" onClick={(e) => e.stopPropagation()}>
            <nav className="flex-1 space-y-1 p-3">
              {nav.map((n) => (
                <Link key={n.to} to={n.to} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium ${active(n.to) ? 'bg-white/10 text-white' : 'text-slate-300'}`}>
                  <Icon name={n.icon} /> {n.label}
                </Link>
              ))}
            </nav>
            {userCard}
          </div>
        </div>
      )}
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-lg font-bold text-slate-800">Halaman tidak dijumpai</div>
      <button type="button" className="text-sm font-semibold text-navy-700 underline" onClick={() => navigate('/')}>
        Kembali ke peta
      </button>
    </div>
  );
}
