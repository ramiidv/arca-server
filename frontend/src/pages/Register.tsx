import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { getRegistrationStatus } from '../api/client';
import { getApiErrorMessage } from '../utils/errors';
import { LARGO_MINIMO_PASSWORD } from '../types';
import { DocumentTextIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  // null = consultando. El registro público solo crea el primer usuario (admin);
  // después, los usuarios los crea un administrador desde Configuración.
  const [abierto, setAbierto] = useState<boolean | null>(null);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  useEffect(() => {
    getRegistrationStatus()
      .then((r) => setAbierto(r.open))
      .catch((err) => {
        setAbierto(false);
        setErrorEstado(getApiErrorMessage(err, 'No se pudo consultar si el registro está abierto'));
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      toast.error('Completá todos los campos');
      return;
    }
    if (password.length < LARGO_MINIMO_PASSWORD) {
      toast.error(`La contraseña tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres`);
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
      toast.success('Cuenta creada exitosamente');
      navigate('/', { replace: true });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Error al registrarse'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-900 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-500/30">
            <DocumentTextIcon className="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white">ARCA</h1>
          <p className="mt-1 text-sm text-indigo-300">Facturación Electrónica</p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white p-8 shadow-2xl"
          noValidate
        >
          <h2 className="mb-2 text-center text-xl font-semibold text-gray-900">
            Crear Cuenta
          </h2>
          {abierto === false ? (
            <p className="mb-6 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-800" role="alert">
              {errorEstado ?? 'El registro está cerrado: ya hay usuarios. Pedile a un administrador que te cree una cuenta.'}
            </p>
          ) : (
            <p className="mb-6 text-center text-xs text-gray-500">
              Es la primera cuenta del sistema: va a tener rol de administrador.
            </p>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Nombre
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="Tu nombre"
              />
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <div className="relative mt-1">
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-10 text-gray-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder={`Mínimo ${LARGO_MINIMO_PASSWORD} caracteres`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
                Confirmar Contraseña
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="Repetí la contraseña"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || abierto !== true}
            className="mt-6 flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Creando cuenta...
              </>
            ) : (
              'Crear Cuenta'
            )}
          </button>

          <p className="mt-4 text-center text-sm text-gray-500">
            ¿Ya tenés cuenta?{' '}
            <Link
              to="/login"
              className="font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus:underline"
            >
              Iniciá sesión
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
