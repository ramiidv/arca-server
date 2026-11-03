import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircleIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import {
  getAfipStatus,
  generateCert,
  renewCert,
  getCertInfo,
  testCert,
  resetWsaa,
  getArcaConfig,
  createUser,
} from '../api/client';
import { getApiErrorMessage } from '../utils/errors';
import { useAuth } from '../context/AuthContext';
import { LARGO_MINIMO_PASSWORD, NOMBRE_AMBIENTE } from '../types';
import type { ArcaConfig, ArcaStatus, ServicioStatus } from '../types';

/** Servidores que informa el `dummy` de cada servicio (nombres del SDK). */
const SERVIDORES = [
  ['appserver', 'AppServer'],
  ['dbserver', 'DbServer'],
  ['authserver', 'AuthServer'],
] as const;

export default function Settings() {
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin';

  // Ambiente y CUIT activos del server (AFIP_PRODUCTION, AFIP_CUIT): el certificado tiene que
  // ser de esa CUIT y ese ambiente, y "Verificar con WSAA" prueba en ese ambiente.
  const [arcaConfig, setArcaConfig] = useState<ArcaConfig | null>(null);

  const [afipStatus, setAfipStatus] = useState<ArcaStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Cert info
  const [certInfo, setCertInfo] = useState<{ notBefore: string; notAfter: string; daysLeft: number; expired: boolean } | null>(null);
  const [loadingCertInfo, setLoadingCertInfo] = useState(true);

  // Cert generation
  const [certAction, setCertAction] = useState<'create' | 'renew'>('create');
  const [certCuit, setCertCuit] = useState('');
  const [certPassword, setCertPassword] = useState('');
  const [certAlias, setCertAlias] = useState('arca-server');
  const [generatingCert, setGeneratingCert] = useState(false);
  const [certResult, setCertResult] = useState<{ alias: string; message: string } | null>(null);

  // Test cert
  const [testingCert, setTestingCert] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; message: string } | null>(null);

  useEffect(() => {
    loadCertInfo();
    getArcaConfig()
      .then((cfg) => {
        setArcaConfig(cfg);
        if (cfg.cuit) setCertCuit(cfg.cuit);
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, 'No se pudo obtener la configuración de ARCA del server'), { duration: 8000 });
      });
  }, []);

  const loadCertInfo = async () => {
    try {
      setLoadingCertInfo(true);
      const result = await getCertInfo();
      setCertInfo(result);
    } catch (err) {
      setCertInfo(null);
      toast.error(getApiErrorMessage(err, 'No se pudo leer el certificado instalado'), { duration: 8000 });
    } finally {
      setLoadingCertInfo(false);
    }
  };

  const checkStatus = async () => {
    try {
      setCheckingStatus(true);
      const status = await getAfipStatus();
      setAfipStatus(status);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'No se pudo conectar con ARCA'), { duration: 8000 });
      setAfipStatus(null);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleGenerateCert = async () => {
    if (!certCuit || !certPassword || !certAlias) {
      toast.error('Completá CUIT, clave fiscal y alias');
      return;
    }

    try {
      setGeneratingCert(true);
      setCertResult(null);
      setTestResult(null);

      const fn = certAction === 'renew' ? renewCert : generateCert;
      // Sin environment: el backend usa su ambiente activo (y rechaza otro).
      const result = await fn({ cuit: certCuit, password: certPassword, alias: certAlias });

      setCertResult(result);
      setCertPassword('');
      toast.success(certAction === 'renew' ? 'Certificado renovado' : 'Certificado generado');
      loadCertInfo();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al generar el certificado'), { duration: 8000 });
    } finally {
      setGeneratingCert(false);
    }
  };

  // Tras un error permanente de WSAA (certificado vencido, servicio no autorizado...) el SDK no
  // vuelve a pedir tickets hasta que se corrija la causa y se limpie la espera.
  const [resettingWsaa, setResettingWsaa] = useState(false);
  const handleResetWsaa = async () => {
    try {
      setResettingWsaa(true);
      const result = await resetWsaa();
      toast.success(result.message);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'No se pudo reiniciar la autenticación'), { duration: 8000 });
    } finally {
      setResettingWsaa(false);
    }
  };

  const handleTestCert = async () => {
    try {
      setTestingCert(true);
      setTestResult(null);
      const result = await testCert();
      setTestResult(result);
      toast.success('Certificado válido');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al verificar el certificado'), { duration: 8000 });
      setTestResult({ valid: false, message: 'Autenticación fallida' });
    } finally {
      setTestingCert(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Current Certificate Info */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50">
              <ShieldCheckIcon className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Certificado Actual</h3>
              <p className="text-xs text-gray-500">
                Estado del certificado instalado
                {arcaConfig && <> · Ambiente: {NOMBRE_AMBIENTE[arcaConfig.environment]}</>}
              </p>
            </div>
          </div>
          <button onClick={handleTestCert} disabled={testingCert || loadingCertInfo} className="btn-secondary text-xs">
            {testingCert ? (
              <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" /> Verificando...</>
            ) : (
              'Verificar con WSAA'
            )}
          </button>
        </div>

        {loadingCertInfo ? (
          <div className="flex justify-center py-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : certInfo ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-100 px-3 py-2.5">
                <p className="text-[11px] text-gray-400">Válido desde</p>
                <p className="text-sm font-medium">{new Date(certInfo.notBefore).toLocaleDateString('es-AR')}</p>
              </div>
              <div className="rounded-lg border border-gray-100 px-3 py-2.5">
                <p className="text-[11px] text-gray-400">Vence</p>
                <p className="text-sm font-medium">{new Date(certInfo.notAfter).toLocaleDateString('es-AR')}</p>
              </div>
              <div className={`rounded-lg border px-3 py-2.5 ${
                certInfo.expired ? 'border-red-200 bg-red-50' :
                certInfo.daysLeft < 30 ? 'border-amber-200 bg-amber-50' :
                'border-emerald-200 bg-emerald-50'
              }`}>
                <p className="text-[11px] text-gray-400">Estado</p>
                <div className="flex items-center gap-1.5">
                  {certInfo.expired ? (
                    <><ExclamationTriangleIcon className="h-4 w-4 text-red-500" /><span className="text-sm font-semibold text-red-700">Expirado</span></>
                  ) : certInfo.daysLeft < 30 ? (
                    <><ClockIcon className="h-4 w-4 text-amber-500" /><span className="text-sm font-semibold text-amber-700">{certInfo.daysLeft} días</span></>
                  ) : (
                    <><CheckCircleIcon className="h-4 w-4 text-emerald-500" /><span className="text-sm font-semibold text-emerald-700">{certInfo.daysLeft} días</span></>
                  )}
                </div>
              </div>
            </div>

            {testResult && (
              <div className={`rounded-lg border px-3 py-2.5 ${testResult.valid ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <div className="flex items-center gap-2">
                  {testResult.valid ? (
                    <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
                  )}
                  <p className={`text-sm font-medium ${testResult.valid ? 'text-emerald-700' : 'text-red-700'}`}>
                    {testResult.message}
                  </p>
                </div>
              </div>
            )}

            {(certInfo.expired || certInfo.daysLeft < 30) && (
              <p className="text-xs text-amber-600">
                {certInfo.expired ? 'El certificado expiró. Generá o renová uno nuevo.' : 'El certificado vence pronto. Considerá renovarlo.'}
              </p>
            )}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-gray-400">No hay certificado instalado</p>
        )}
      </div>

      {/* Generate / Renew Certificate (solo admin) */}
      {esAdmin ? (
      <div className="card">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Generar Certificado</h3>
        <p className="mb-4 text-xs text-gray-500">
          El certificado tiene que ser de la CUIT y del ambiente con los que factura el server
          {arcaConfig && (
            <> (CUIT {arcaConfig.cuit ?? 'sin configurar'}, {NOMBRE_AMBIENTE[arcaConfig.environment]})</>
          )}
          . Para usar otra CUIT u otro ambiente, cambiá AFIP_CUIT o AFIP_PRODUCTION y reiniciá el server.
        </p>

        {/* Action tabs */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setCertAction('create')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              certAction === 'create' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Nuevo
          </button>
          <button
            onClick={() => setCertAction('renew')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              certAction === 'renew' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Renovar
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">CUIT</label>
              <input type="text" value={certCuit} onChange={(e) => setCertCuit(e.target.value)} className="input" placeholder="20123456786" />
            </div>
            <div>
              <label className="label">Clave Fiscal</label>
              <input type="password" value={certPassword} onChange={(e) => setCertPassword(e.target.value)} className="input" placeholder="Tu clave fiscal de ARCA" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Alias del Certificado</label>
              <input type="text" value={certAlias} onChange={(e) => setCertAlias(e.target.value)} className="input" placeholder="mi-sistema" />
              {certAction === 'renew' && (
                <p className="mt-1 text-[11px] text-gray-400">Se generará un alias nuevo con sufijo temporal</p>
              )}
            </div>
            <div>
              <p className="label">Ambiente</p>
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {arcaConfig ? NOMBRE_AMBIENTE[arcaConfig.environment] : '—'}
                <span className="text-xs text-gray-400"> (AFIP_PRODUCTION del server)</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleGenerateCert} disabled={generatingCert} className="btn-primary">
              {generatingCert ? (
                <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Generando...</>
              ) : certAction === 'renew' ? (
                'Renovar Certificado'
              ) : (
                'Generar Certificado'
              )}
            </button>
            <p className="text-[11px] text-gray-400">
              {certAction === 'renew'
                ? 'Crea un certificado nuevo con alias distinto. El anterior sigue válido hasta expirar.'
                : 'Se loguea al portal de ARCA, genera la clave y obtiene el certificado firmado.'}
            </p>
          </div>

          {certResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="h-5 w-5 text-emerald-500" />
                <p className="text-sm font-semibold text-emerald-800">{certResult.message}</p>
              </div>
              <p className="mt-1 font-mono text-[11px] text-emerald-600">Alias: {certResult.alias}</p>
            </div>
          )}
        </div>
      </div>
      ) : (
        <div className="card">
          <h3 className="mb-2 text-base font-semibold text-gray-900">Generar Certificado</h3>
          <p className="text-sm text-gray-500">Solo un administrador puede generar o renovar el certificado de ARCA.</p>
        </div>
      )}

      {esAdmin && <CrearUsuario />}

      {/* ARCA Status */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Estado de ARCA</h3>
          <button onClick={checkStatus} disabled={checkingStatus} className="btn-secondary text-xs">
            {checkingStatus ? (
              <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Verificando...</>
            ) : (
              <><ArrowPathIcon className="h-4 w-4" /> Verificar</>
            )}
          </button>
        </div>

        {afipStatus ? (
          <div className="space-y-4">
            <EstadoServicio nombre="WSFEv1 (facturación)" estado={afipStatus.wsfe} />
            <EstadoServicio nombre="WSFEX (exportación)" estado={afipStatus.wsfex} />
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-gray-400">Hacé clic en "Verificar" para comprobar la conexión con ARCA</p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500">
            Si WSAA rechazó el certificado (vencido, servicio no autorizado), corregí la causa y reintentá la autenticación.
          </p>
          <button onClick={handleResetWsaa} disabled={resettingWsaa} className="btn-secondary text-xs">
            <ArrowPathIcon className={`h-4 w-4 ${resettingWsaa ? 'animate-spin' : ''}`} /> Reintentar autenticación
          </button>
        </div>
      </div>

      {/* App Info */}
      <div className="card">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Información</h3>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Versión</span>
            <span className="font-medium">2.0.0</span>
          </div>
          <div className="flex justify-between">
            <span>Stack</span>
            <span className="text-xs font-medium">React 19 + Vite 8 + Express 5 + Prisma 7</span>
          </div>
          <div className="flex justify-between">
            <span>SDK</span>
            <span className="text-xs font-medium">@ramiidv/arca-facturacion, -padron, -cdc, -fecred, -mtxca, -sire, -agro, -empleados + arca-cert</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Estado de un servicio de ARCA (`{ ok, status }` o `{ ok: false, error, status? }`). */
function EstadoServicio({ nombre, estado }: { nombre: string; estado: ServicioStatus }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{nombre}</p>
      {!estado.ok && <p className="text-xs text-red-600">{estado.error}</p>}
      {estado.status &&
        SERVIDORES.map(([campo, etiqueta]) => {
          const valor = estado.status?.[campo];
          return (
            <div key={campo} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5">
              <span className="text-sm font-medium text-gray-700">{etiqueta}</span>
              <span className="flex items-center gap-1.5">
                {valor === 'OK' ? (
                  <><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /><span className="text-xs font-medium text-emerald-700">OK</span></>
                ) : (
                  <><span className="h-1.5 w-1.5 rounded-full bg-red-400" /><span className="text-xs font-medium text-red-700">{valor || 'Error'}</span></>
                )}
              </span>
            </div>
          );
        })}
    </div>
  );
}

/** Alta de usuarios (solo admin): el registro público solo crea el primer usuario. */
function CrearUsuario() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [guardando, setGuardando] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || password.length < LARGO_MINIMO_PASSWORD) {
      toast.error(`Completá nombre, email y una contraseña de al menos ${LARGO_MINIMO_PASSWORD} caracteres`);
      return;
    }
    try {
      setGuardando(true);
      const nuevo = await createUser({ name, email, password, role });
      toast.success(`Usuario ${nuevo.email} creado`);
      setName('');
      setEmail('');
      setPassword('');
      setRole('user');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al crear el usuario'), { duration: 8000 });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card space-y-4" noValidate>
      <div>
        <h3 className="text-base font-semibold text-gray-900">Crear Usuario</h3>
        <p className="mt-1 text-xs text-gray-500">
          El registro público está cerrado: los usuarios nuevos los crea un administrador. Solo los
          administradores pueden generar o renovar el certificado.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="nuevo-nombre">Nombre</label>
          <input id="nuevo-nombre" value={name} onChange={(e) => setName(e.target.value)} className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="nuevo-email">Email</label>
          <input id="nuevo-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="nuevo-password">Contraseña</label>
          <input
            id="nuevo-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder={`Mínimo ${LARGO_MINIMO_PASSWORD} caracteres`}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label" htmlFor="nuevo-rol">Rol</label>
          <select id="nuevo-rol" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} className="select">
            <option value="user">Usuario</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
      </div>
      <button type="submit" disabled={guardando} className="btn-primary">
        {guardando ? 'Creando...' : 'Crear Usuario'}
      </button>
    </form>
  );
}
