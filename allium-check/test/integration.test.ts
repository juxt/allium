import { execSync, ExecSyncOptions } from 'child_process';
import { describe, it } from 'node:test';
import assert from 'node:assert';

const CLI = 'node dist/cli.js';
const FIXTURES = 'test/fixtures';

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function run(file: string): RunResult {
  const opts: ExecSyncOptions = {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  try {
    const stdout = execSync(`${CLI} ${FIXTURES}/${file}`, opts) as string;
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('valid specs', () => {
  it('valid.allium passes with no errors', () => {
    const result = run('valid.allium');
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stderr, '');
  });

  it('ecommerce.allium passes with no errors', () => {
    const result = run('ecommerce.allium');
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stderr, '');
  });

  it('project-mgmt.allium passes with no errors', () => {
    const result = run('project-mgmt.allium');
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stderr, '');
  });
});

describe('invalid.allium', () => {
  const result = run('invalid.allium');

  it('exits with code 1', () => {
    assert.strictEqual(result.exitCode, 1);
  });

  it('catches undefined type Proflie', () => {
    assert.match(result.stderr, /undefined type 'Proflie'/);
  });

  it('catches undefined entity Poast', () => {
    assert.match(result.stderr, /undefined entity 'Poast'/);
  });

  it('catches undefined entity Usr with suggestion', () => {
    assert.match(result.stderr, /undefined entity 'Usr'.*did you mean 'User'/);
  });

  it('catches undefined identifier usre with suggestion', () => {
    assert.match(result.stderr, /undefined identifier 'usre'.*did you mean 'usr'/);
  });

  it('catches undefined identifier user', () => {
    assert.match(result.stderr, /undefined identifier 'user'/);
  });

  it('catches undefined entity Sesion with suggestion', () => {
    assert.match(result.stderr, /undefined entity 'Sesion'.*did you mean 'Session'/);
  });

  it('catches invalid enum value activ with suggestion', () => {
    assert.match(result.stderr, /invalid enum value 'activ'.*did you mean 'active'/);
  });
});

describe('with-errors.allium', () => {
  const result = run('with-errors.allium');

  it('exits with code 1', () => {
    assert.strictEqual(result.exitCode, 1);
  });

  it('catches undefined type Uzer with suggestion', () => {
    assert.match(result.stderr, /undefined type 'Uzer'.*did you mean 'Usr'/);
  });

  it('catches undefined entity Coment with suggestion', () => {
    assert.match(result.stderr, /undefined entity 'Coment'.*did you mean 'Comment'/);
  });

  it('catches undefined identifier docment with suggestion', () => {
    assert.match(result.stderr, /undefined identifier 'docment'.*did you mean 'document'/);
  });

  it('catches undefined entity DocAccess', () => {
    assert.match(result.stderr, /undefined entity 'DocAccess'/);
  });

  it('catches undefined entity Commment with suggestion', () => {
    assert.match(result.stderr, /undefined entity 'Commment'.*did you mean 'Comment'/);
  });
});

describe('error output format', () => {
  const result = run('invalid.allium');

  it('follows file:line:col: message format', () => {
    const lines = result.stderr.trim().split('\n');
    for (const line of lines) {
      assert.match(line, /^[^:]+:\d+:\d+: .+$/);
    }
  });

  it('includes line numbers', () => {
    // Check specific line numbers from invalid.allium
    assert.match(result.stderr, /invalid\.allium:8:\d+:/);  // Proflie
    assert.match(result.stderr, /invalid\.allium:11:\d+:/); // Poast
    assert.match(result.stderr, /invalid\.allium:23:\d+:/); // Usr
  });
});

describe('file not found', () => {
  it('exits with code 1 for missing file', () => {
    const result = run('nonexistent.allium');
    assert.strictEqual(result.exitCode, 1);
  });
});
