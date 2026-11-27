import { type User } from "firebase/auth";
import { createContext, useContext } from "react";

export type FirebaseContextValue = {
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
};

export const FirebaseContext = createContext<FirebaseContextValue>({
  user: null,
  authReady: false,
  isAdmin: false,
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
});

export function useFirebaseAuth() {
  return useContext(FirebaseContext);
}
