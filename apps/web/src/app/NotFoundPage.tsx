import { Link } from 'react-router';
import { buttonClasses } from '../components/ui/Button';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Page not found');

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-sm font-medium text-brand">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        That address does not match any section of the application.
      </p>
      <Link to="/" className={buttonClasses('primary', 'md', 'mt-6')}>
        Back to the overview
      </Link>
    </div>
  );
}
