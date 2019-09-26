import {Vault} from "../Vault";
import {AbstractVaultClient} from "../VaultClient";
import {IVaultTokenAuthResponse, IVaultTokenRenewOptions, IVaultTokenRenewSelfOptions} from "./token_types";
import tokenTi from "./token_types-ti";
import {createCheckers} from "ts-interface-checker";

const tiChecker = createCheckers(tokenTi);

// Time in ms to renew token before expiration
const RENEW_BEFORE_MS = 10000;

export class VaultTokenClient extends AbstractVaultClient {

    private state?: IVaultTokenAuthResponse;
    private expires?: Date;

    get token() {
        if (this.state) {
            return this.state.auth.client_token;
        }
    }

    constructor(vault: Vault, mountPoint: string = "token", private authProvider?: IVaultAuthProvider) {
        super(vault, ["auth", mountPoint]);
    }

    public async renew(options?: IVaultTokenRenewOptions): Promise<IVaultTokenAuthResponse> {
        return this.rawWrite(["/renew"], options).then((res) => {
            tiChecker.IVaultTokenAuthResponse.check(res);
            return res;
        });
    }

    public async renewSelf(options?: IVaultTokenRenewSelfOptions, authProviderFallback: boolean = false): Promise<IVaultTokenAuthResponse> {
        let newState: IVaultTokenAuthResponse;
        try {
            newState = await this.rawWrite(["/renew-self"], options).then((res) => {
                tiChecker.IVaultTokenAuthResponse.check(res);
                return res;
            });
        } catch (e) {
            if (!this.authProvider || !authProviderFallback) {
                throw e;
            }
            newState = await this.authProvider.auth();
        }
        const expires = new Date();
        expires.setSeconds(expires.getSeconds() + newState.auth.lease_duration);
        this.state = newState;
        this.expires = expires;
        return this.state;
    }

    public async enableAutoRenew(): Promise<IVaultTokenAuthResponse> {
        return this.autoRenew();
    }

    private async autoRenew(): Promise<IVaultTokenAuthResponse> {
        return this.renewSelf(undefined, true)
            .then((res) => {
                setTimeout(this.autoRenew.bind(this), (this.expires!.getTime() - new Date().getTime()) - RENEW_BEFORE_MS );
                return res;
            }).catch((e) => {
                this.vault.emit("error", e);
                throw e;
            });
    }
}

export interface IVaultAuthProvider {
    auth(): Promise<IVaultTokenAuthResponse>;
}
