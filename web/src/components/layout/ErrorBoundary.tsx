import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    /* keep the recovery screen; do not log stacks or signed bytes */
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="section" id="main-content">
        <div className="wrap stack lg not-found">
          <p className="eyebrow">Recoverable failure</p>
          <h1>This mutation did not survive.</h1>
          <p className="body-copy">Reload the lab. This crash did not sign a transaction.</p>
          <p>
            <a className="btn primary" href="/">
              Back to the lab
            </a>
          </p>
        </div>
      </main>
    );
  }
}
