import React, { useMemo } from "react";
import {
    NavigationProvider,
    useNavigation,
    type NavigationContextValue,
    type AppView,
} from "./NavigationContext";
import {
    AuthProfileProvider,
    useAuthProfile,
    type AuthProfileContextValue,
} from "./AuthProfileContext";
import {
    DataProvider,
    useData,
    type DataContextValue,
} from "./DataContext";

export { useNavigation, useAuthProfile, useData };
export type {
    AppView,
    NavigationContextValue,
    AuthProfileContextValue,
    DataContextValue,
};

export type AppContextValue = NavigationContextValue &
    AuthProfileContextValue &
    DataContextValue;

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    return (
        <NavigationProvider>
            <AuthProfileProvider>
                <DataProvider>{children}</DataProvider>
            </AuthProfileProvider>
        </NavigationProvider>
    );
};

export const useApp = (): AppContextValue => {
    const navigation = useNavigation();
    const authProfile = useAuthProfile();
    const data = useData();

    return useMemo(
        () => ({
            ...navigation,
            ...authProfile,
            ...data,
        }),
        [navigation, authProfile, data],
    );
};
