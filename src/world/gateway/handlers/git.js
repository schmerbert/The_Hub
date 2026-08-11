function outcome(result) { return { result, source: null, changedRoom: false }; }

export const GIT_HANDLERS = Object.freeze({
  workshop_git_status: ({ git }) => outcome(git.status()),
  workshop_git_diff: ({ git, args }) => outcome(git.diff(args.path)),
  workshop_git_log: ({ git, args }) => outcome(git.log(args.max_count || 20)),
  workshop_git_show: ({ git, args }) => outcome(git.show(args.revision, args.path)),
  workshop_git_branch_list: ({ git }) => outcome(git.branchList()),
  workshop_git_add: ({ git, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = git.previewAdd({ paths: args.paths || [], update: args.update });
    return outcome(pendingConfirm(sessionId, wakeId, 'git_add', { paths: args.paths || [], update: Boolean(args.update) }, preview, 'workshop_git_add'));
  },
  workshop_git_commit: ({ git, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = git.previewCommit({ message: args.message, paths: args.paths || [] });
    return outcome(pendingConfirm(sessionId, wakeId, 'commit', { message: args.message, paths: args.paths || [] }, preview, 'workshop_git_commit'));
  },
  workshop_git_checkout: ({ git, sessionId, wakeId, args, pendingConfirm }) => {
    const preview = git.previewCheckout(args.branch);
    return outcome(pendingConfirm(sessionId, wakeId, 'git_checkout', { branch: args.branch }, preview, 'workshop_git_checkout'));
  },
});
