import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import Home from '../Home';
import { AppStoreProvider } from '../../context/AppStore';

expect.extend(toHaveNoViolations);

describe('Home page', () => {
  test('renders accessible upload control', () => {
    render(
      <BrowserRouter>
        <AppStoreProvider>
          <Home />
        </AppStoreProvider>
      </BrowserRouter>,
    );

    expect(screen.getByLabelText(/cv file upload/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
  });

  test('has no obvious a11y violations', async () => {
    const { container } = render(
      <BrowserRouter>
        <AppStoreProvider>
          <Home />
        </AppStoreProvider>
      </BrowserRouter>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
