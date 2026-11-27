/**
 * "HR All Users" (user:all_users) widens the user permissions to every
 * user; without it they apply only to the actor's own team.
 */
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserLogic } from './user.logic';

const ME = new Types.ObjectId().toString();
const TEAM = new Types.ObjectId().toString();
const OUTSIDER = new Types.ObjectId().toString();

function makeLogic() {
  const logic = Object.create(UserLogic.prototype) as UserLogic;
  (logic as any).profileData = {
    findByUserId: async (id: string) => ({ userId: id, departmentId: 'd1', reportingSeniorId: id === TEAM ? ME : 'x' }),
  };
  (logic as any).getUsersUnder = async () => [{ _id: new Types.ObjectId(TEAM) }];
  return logic;
}

const actor = (actions: string[], roleName = 'bd') => ({ userId: ME, roleName, permissions: [{ module: 'user', actions }] });

describe('user scope (HR All Users)', () => {
  const logic = makeLogic();

  it('only user:all_users (or admin) gives full user access; onboarding alone does not', () => {
    expect(logic.hasFullUserAccess(actor(['read', 'onboarding']))).toBe(false);
    expect(logic.hasFullUserAccess(actor(['read', 'all_users']))).toBe(true);
    expect(logic.hasFullUserAccess(actor([], 'Admin'))).toBe(true);
    expect(logic.canManageOnboarding(actor(['onboarding']))).toBe(true);
    expect(logic.canManageOnboarding(actor(['read']))).toBe(false);
  });

  it('without all_users: team members only', async () => {
    await expect(logic.assertCanManageUser(actor(['update']), TEAM)).resolves.toBeUndefined();
    await expect(logic.assertCanManageUser(actor(['update']), OUTSIDER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('with all_users: anyone', async () => {
    await expect(logic.assertCanManageUser(actor(['update', 'all_users']), OUTSIDER)).resolves.toBeUndefined();
  });

  it('status / block need their own permission, a target in scope, and not yourself', async () => {
    await expect(logic.assertCanChangeUser(actor(['read']), TEAM, 'status')).rejects.toThrow('user:status');
    await expect(logic.assertCanChangeUser(actor(['status']), TEAM, 'status')).resolves.toBeUndefined();
    await expect(logic.assertCanChangeUser(actor(['status']), OUTSIDER, 'status')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(logic.assertCanChangeUser(actor(['block', 'all_users']), OUTSIDER, 'block')).resolves.toBeUndefined();
    await expect(logic.assertCanChangeUser(actor(['block', 'all_users']), ME, 'block')).rejects.toThrow('own account');
    await expect(logic.assertCanChangeUser(actor([], 'Admin'), OUTSIDER, 'block')).resolves.toBeUndefined();
  });
});
