import type { LiveRoomUser, RoomCapability } from './types.js';

export class LiveRoomUserState implements LiveRoomUser {
  private snapshot: LiveRoomUser = {
    id: '',
    externalId: undefined,
    nickname: '',
    avatarUrl: undefined,
    role: 'viewer',
    capabilities: []
  };

  get id(): string {
    return this.snapshot.id;
  }

  get externalId(): string | undefined {
    return this.snapshot.externalId;
  }

  get nickname(): string {
    return this.snapshot.nickname;
  }

  get avatarUrl(): string | undefined {
    return this.snapshot.avatarUrl;
  }

  get role(): 'viewer' | 'operator' {
    return this.snapshot.role;
  }

  get capabilities(): readonly RoomCapability[] {
    return this.snapshot.capabilities;
  }

  hydrate(next: LiveRoomUser): void {
    this.snapshot = {
      ...next,
      capabilities: [...next.capabilities]
    };
  }

  clear(): void {
    this.snapshot = {
      id: '',
      externalId: undefined,
      nickname: '',
      avatarUrl: undefined,
      role: 'viewer',
      capabilities: []
    };
  }
}
