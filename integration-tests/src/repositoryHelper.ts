import * as Path from 'path';
import * as Config from './config';
import * as fs from 'fs';
import Chalk from 'chalk';
import { ShouldCheckOptions, shouldCheckRepo } from './shouldCheckRepo';
import { Logger } from './types';
import simpleGit from 'simple-git';
import mkdirp from 'mkdirp';
import { Octokit } from '@octokit/rest';
import { Repository } from './configDef';

export const repositoryDir = Path.resolve(Path.join(__dirname, '../repositories/temp'));

const minCommitDepth = 10; // To handle race condition with respect to commits.

const githubUrlRegexp = /^(git@github\.com:|https:\/\/github\.com\/).+$/i;

export async function addRepository(
    logger: Logger,
    url: string,
    branch: string | undefined
): Promise<Repository | undefined> {
    if (!url || !githubUrlRegexp.test(url)) {
        return undefined;
    }

    const httpsUrl = url.replace('git@github.com:', 'https://github.com/');

    try {
        const repoInfo = fetchRepositoryInfoForRepo(httpsUrl);
        const { path, url, commit } = await repoInfo;
        return Config.addRepository(path, url, branch || commit, branch);
    } catch (e) {
        logger.error(e);
        return undefined;
    }
}

interface RepositoryInfo {
    path: string;
    url: string;
    commit: string;
}

export async function fetchRepositoryInfoForRepo(url: string): Promise<RepositoryInfo> {
    const httpsUrl = url.replace('git@github.com:', 'https://github.com/');
    const relPath = httpsUrl
        .replace(/\.git$/, '')
        .split('/')
        .slice(3);
    const [owner, repo] = relPath;
    const path = relPath.join('/');

    const octokit = getOctokit();
    const r = await octokit.repos.get({ owner, repo });
    const branch = r.data.default_branch;

    const b = await octokit.repos.getBranch({ owner, repo, branch });

    return {
        path,
        url: httpsUrl,
        commit: b.data.commit.sha || branch,
    };
}

export async function checkoutRepositoryAsync(
    logger: Logger,
    url: string,
    path: string,
    commit: string
): Promise<boolean> {
    const { log, error } = logger;
    path = Path.resolve(Path.join(repositoryDir, path));
    if (!fs.existsSync(path)) {
        try {
            const repoInfo = await fetchRepositoryInfoForRepo(url);
            const c = await cloneRepo(logger, url, path, commit === repoInfo.commit ? minCommitDepth : undefined);
            if (!c) {
                return false;
            }
        } catch (e) {
            error(e);
            return false;
        }
    }
    log(`checkout ${url}`);
    const git = simpleGit(path);
    const pCheckout = git.checkout(commit, ['--force']);
    git.log();
    try {
        const r = await pCheckout;
        log(`checked out ${r}`);
    } catch (e) {
        error(e);
        return false;
    }
    return true;
}

async function cloneRepo(
    { log, error }: Logger,
    url: string,
    path: string,
    depth: number | undefined
): Promise<boolean> {
    log(`Cloning ${url} depth: ${depth || 'unlimited'}`);
    await mkdirp(Path.dirname(path));
    const options = ['--no-checkout'];
    if (depth) {
        options.push(`--depth=${depth}`);
    }
    try {
        const git = simpleGit();
        const c = await git.clone(url, path, options);
        log(`Cloned: ${c}`);
    } catch (e) {
        error(e);
        return false;
    }
    return true;
}

export type ListRepositoryOptions = ShouldCheckOptions;

export async function listRepositories(options: ListRepositoryOptions): Promise<void> {
    const config = Config.readConfig();
    const pValues = config.repositories
        .filter((rep) => shouldCheckRepo(rep, options))
        .map(async (rep) => {
            const info = await fetchRepositoryInfoForRepo(rep.url);
            return {
                ...rep,
                dirty: rep.commit !== info.commit,
                head: info.commit,
            };
        });

    const compare = new Intl.Collator().compare;
    const values = (await Promise.all(pValues)).sort((a, b) => compare(a.path, b.path));

    values.forEach((rep) => {
        if (rep.dirty) {
            console.log(Chalk.red`${rep.path} *`);
        } else {
            console.log(rep.path);
        }
    });
}

function getOctokit(auth?: string | undefined): Octokit {
    auth = auth || process.env['GITHUB_TOKEN'] || undefined;
    const options = auth ? { auth } : undefined;
    return new Octokit(options);
}
