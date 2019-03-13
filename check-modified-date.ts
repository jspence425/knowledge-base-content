import * as path from 'path';
import * as moment from 'moment';
import * as frontmatter from 'gray-matter';
import { Commit, DiffFile, Object, Repository, Revparse } from 'nodegit';

interface Frontmatter {
  title: string;
  description: string;
  priority: number;
  date_published: string;
  date_modified: string;
}

const getFile = async (commit: Commit, path: string): Promise<string> => {
  const entry = await commit.getEntry(path);
  const blob = await entry.getBlob();
  return blob.toString();
};

const isDateUpdated = async (commit: Commit, firstFile: DiffFile, lastFile: DiffFile): Promise<boolean> => {
  const firstFileContents = frontmatter(await getFile(commit, firstFile.path())) as { data: Frontmatter };
  const lastFileContents = frontmatter(await getFile(commit, lastFile.path())) as { data: Frontmatter };

  const now = moment.utc();
  const firstTime = moment.utc(firstFileContents.data.date_modified);
  const lastTime = moment.utc(lastFileContents.data.date_modified);

  return now.isSame(lastTime) || !firstTime.isSame(lastTime);
};

/**
 * Checks if `date_modified` field for articles was updated.
 */
const checkCommits = async (firstCommitHash: string, lastCommitHash: string): Promise<void> => {
  const repository = await Repository.open(path.join(__dirname, '.git'));

  const firstCommit = await repository.getCommit((await Revparse.single(repository, firstCommitHash)).id());
  const lastCommit = await repository.getCommit((await Revparse.single(repository, lastCommitHash)).id());
  const lastCommitObject = await Object.lookup(repository, lastCommit.id(), Object.TYPE.COMMIT);

  const files: string[] = [];

  const diffs = await firstCommit.getDiffWithOptions(lastCommitObject);
  for (const diff of diffs) {
    const patches = await diff.patches();
    for (const patch of patches) {
      // Ignore new files and README.md
      if (!patch.isAdded() && patch.newFile().path().match(/\.md$/) && !patch.newFile().path().includes('README.md')) {
        if (!await isDateUpdated(lastCommit, patch.oldFile(), patch.newFile())) {
          files.push(patch.newFile().path());
        }
      }
    }
  }

  if (files.length > 0) {
    console.error(`Please update the 'date_modified' field in the following file(s):\n - ${files.join('\n - ')}`);
    process.exit(1);
  }
};

if (process.env.TRAVIS_COMMIT_RANGE) {
  const commits = process.env.TRAVIS_COMMIT_RANGE.split('...');
  checkCommits(commits[0], commits[1])
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
