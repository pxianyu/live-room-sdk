export class LiveRoomUserState {
    snapshot = {
        id: '',
        externalId: undefined,
        nickname: '',
        avatarUrl: undefined,
        role: 'viewer',
        capabilities: []
    };
    get id() {
        return this.snapshot.id;
    }
    get externalId() {
        return this.snapshot.externalId;
    }
    get nickname() {
        return this.snapshot.nickname;
    }
    get avatarUrl() {
        return this.snapshot.avatarUrl;
    }
    get role() {
        return this.snapshot.role;
    }
    get capabilities() {
        return this.snapshot.capabilities;
    }
    hydrate(next) {
        this.snapshot = {
            ...next,
            capabilities: [...next.capabilities]
        };
    }
    clear() {
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
//# sourceMappingURL=User.js.map