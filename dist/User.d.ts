import type { LiveRoomUser, RoomCapability } from './types.js';
export declare class LiveRoomUserState implements LiveRoomUser {
    private snapshot;
    get id(): string;
    get externalId(): string | undefined;
    get nickname(): string;
    get avatarUrl(): string | undefined;
    get role(): 'viewer' | 'operator';
    get capabilities(): readonly RoomCapability[];
    hydrate(next: LiveRoomUser): void;
    clear(): void;
}
//# sourceMappingURL=User.d.ts.map